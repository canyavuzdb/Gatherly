# Gatherly data model

This is the complete MVP persistence model. PostgreSQL is the source of truth; RabbitMQ and Socket.IO do not own business records.

## Conventions

- Every identifier is a UUID.
- Timestamps are stored as `timestamptz`.
- Mutable records use `created_at`, `updated_at`, and `version`; records changed by an actor also use `updated_by_user_id` and `updated_by_kind` (`USER` or `SYSTEM`). This is last-change metadata, not a full audit trail.
- No `audit_logs` or transactional outbox table exists in the MVP.
- A `NULL` foreign key denotes an optional relationship. Rows are not deleted merely to represent a domain transition: an Event is cancelled, an Attendance is cancelled, and an Invitation is revoked through state.

## Identity and account recovery

### `users`

```text
id                         uuid primary key
email                      citext not null unique
password_hash              text not null
email_verified_at          timestamptz null
status                     user_status not null default 'ACTIVE'
created_at                 timestamptz not null
updated_at                 timestamptz not null
version                    integer not null default 1
```

`password_hash` stores an Argon2id digest; no recoverable password representation exists. `user_status`: `ACTIVE`, `SUSPENDED`, `DELETED`. A User must have `email_verified_at` before creating Events, changing Attendance, accepting Invitations, or uploading media. A self-deleted User cannot sign in or take new actions; historical Event and Attendance records remain for referential integrity. Self-deletion is rejected while the User organizes a future Event or has an active Attendance (`CONFIRMED`, `PENDING`, or `WAITLISTED`) for one; the User must first cancel those Events or Attendances.

Suspension is a platform-only status and immediately blocks sign-in. Self-deletion pseudonymizes the email and Profile presentation data while retaining the User identifier and historical references. The pseudonymized email is unique and non-routable; the Profile becomes private, removes its avatar and biography, and presents the User as deleted.

### `profiles`

```text
user_id                    uuid primary key references users(id)
first_name                 varchar(100) not null
last_name                  varchar(100) not null
bio                        varchar(500) null
avatar_media_asset_id      uuid null references media_assets(id)
visibility                 profile_visibility not null default 'EVENT_ATTENDEES'
created_at                 timestamptz not null
created_by_user_id         uuid null references users(id)
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

`profile_visibility`: `PUBLIC`, `EVENT_ATTENDEES`, `PRIVATE`.

A Profile contains only first name, last name, biography, avatar, and visibility. The User may change these values before email verification; names are nonblank and at most 100 characters, biography is at most 500 characters. It exposes no email, Event/Attendance history, Notification, quota, or security data. Visibility is evaluated on every Profile and avatar read: changing it takes effect immediately and grants no permanent historical access. `EVENT_ATTENDEES` permits an Organizer to view a User requesting Attendance for that Organizer's Event; other Users may view one another only when both hold Confirmed Attendance in the same Event. `PRIVATE` permits only the User, except for that Organizer decision context.

### `email_verification_tokens`

```text
id                         uuid primary key
user_id                    uuid not null references users(id)
token_hash                 text not null unique
expires_at                 timestamptz not null
used_at                    timestamptz null
invalidated_at             timestamptz null
created_at                 timestamptz not null
```

Only a digest of the emailed secret is stored. A token is single-use and expires after twenty-four hours. Requesting a new verification token invalidates every earlier unused token for that User; requests for the same User are accepted no more than once per sixty seconds.

### `password_reset_tokens`

```text
id                         uuid primary key
user_id                    uuid not null references users(id)
token_hash                 text not null unique
expires_at                 timestamptz not null
used_at                    timestamptz null
invalidated_at             timestamptz null
created_at                 timestamptz not null
```

Only a digest of the reset secret is stored. A token is single-use, expires after one hour, and a new request invalidates earlier unused reset tokens. Completing a reset revokes every refresh session for that User.

### `refresh_sessions`

```text
id                         uuid primary key
user_id                    uuid not null references users(id)
token_hash                 text not null unique
expires_at                 timestamptz not null
revoked_at                 timestamptz null
created_at                 timestamptz not null
last_used_at               timestamptz null
```

An access token is a short-lived, stateless JWT lasting fifteen minutes. A refresh session lasts at most thirty days; only the digest of its secret is stored. A User may have at most five concurrent refresh sessions, one per signed-in browser or device; a sixth sign-in revokes the oldest active one. Refresh rotates only the used session by revoking its record and creating a new one. The refresh secret travels only in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` is enabled outside local HTTP development. Normal logout revokes the current session; password changes and self-deletion revoke all sessions for the User. The MVP has no device-management screen.

Registration creates an unverified User and an initial refresh session, allowing that User to complete verification from inside the product while the Verified User gate remains in force. Password-reset and verification-resend requests always return the same generic response whether or not the supplied email can receive a link. Registration instead reports `EMAIL_ALREADY_REGISTERED` so the User can correct an accidental repeat registration. A password must contain at least twelve characters and must not appear in a small versioned common-password deny list; no character-class rule applies. Password change and self-deletion require the current password as re-authentication. Reset completion revokes all earlier sessions and creates one new session for the browser that supplied the reset secret. Self-deletion revokes every pending Invitation addressed to that User. It is irreversible: the original email becomes available for a later registration, which creates a distinct new User with no access to the deleted User's history.

## Event discovery and creation

### `categories`

```text
id                         uuid primary key
name                       varchar(80) not null unique
slug                       varchar(80) not null unique
is_active                  boolean not null default true
sort_order                 integer not null default 0
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

An Event has one platform-managed Category in the MVP. An inactive Category may remain on an existing Event but cannot be newly selected for a Draft or revision.

### `events`

```text
id                         uuid primary key
organizer_id               uuid not null references users(id)
category_id                uuid not null references categories(id)
title                      varchar(160) not null
description                text not null
starts_at                  timestamptz not null
ends_at                    timestamptz not null
timezone                   varchar(64) not null
capacity                   integer null
confirmed_count            integer not null default 0
visibility                 event_visibility not null
join_policy                join_policy not null
status                     event_status not null default 'DRAFT'
share_token                uuid null unique
created_at                 timestamptz not null
created_by_user_id         uuid not null references users(id)
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

`event_visibility`: `PUBLIC`, `UNLISTED`, `PRIVATE`.

`join_policy`: `OPEN`, `APPROVAL_REQUIRED`, `INVITE_ONLY`.

`event_status`: `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED`.

Constraints: `ends_at > starts_at`; `capacity is null or capacity > 0`; `confirmed_count >= 0`; and `confirmed_count <= capacity` when capacity exists. A `share_token` is required for an Unlisted Event and never authorizes private attendee data.

A Draft contains the complete Event, Location, and access data required for publication; it is simply not discoverable or joinable. Creating that Draft consumes the User's monthly Event Creation Quota and never refunds it. A Draft may become Published or Cancelled. A Published Event may become Cancelled only before `starts_at`; a scheduled system process changes it to Completed once `ends_at` passes.

`PRIVATE` requires `INVITE_ONLY`; `PUBLIC` and `UNLISTED` may use any Join Policy. Publication requires `starts_at` to be in the future. Until that time, the Organizer may change Event metadata, Location, access rules, and capacity. A bounded capacity cannot be reduced below `confirmed_count`; increasing capacity or changing it to unlimited releases the next capacity opportunity under the same waitlist rule as a cancellation.

An access-rule change affects new requests only. Existing Confirmed, Pending, and Waitlisted Attendances remain active and retain Event access. When an Event is cancelled, its Attendance records remain historical, every pending Invitation is revoked, and active attendees plus Invitation recipients are notified. Leaving `UNLISTED` clears its share token; returning to `UNLISTED` creates a new token. Capacity growth and any resulting `OPEN` waitlist promotion occur in one transaction so a new request cannot bypass the waitlist.

General Event Discovery reads only `PUBLISHED` Events whose `starts_at` is still in the future and whose visibility is `PUBLIC`. It requires a city and accepts optional district, Category, and date-range filters. Results sort by `starts_at ASC, id ASC` and use that tuple as a cursor, with at most fifty results per page. Unlisted and Private Events never enter general discovery. A signed-in User may receive only their own Attendance status beside an otherwise discoverable Event; no roster is projected. Each card and detail returns capacity and remaining-seat information but never other attendees' identities. An inactive Category remains discoverable through its existing Event but is not offered as a Category filter. A Public Event remains directly viewable after completion or cancellation, with its status and no join action, even though it no longer qualifies for general discovery. The MVP has no title/description search, relevance ranking, map/radius, recommendation, cache, or separate search index.

A Personal Calendar returns future Events where the User is Organizer (`DRAFT`, `PUBLISHED`, or `CANCELLED`) or has an active Attendance (`CONFIRMED`, `PENDING`, or `WAITLISTED`). A cancelled Event remains in that view with its status; started and historical Events are outside the MVP calendar query.

The Organizer is immutable in the MVP. A finite capacity increase promotes the oldest eligible Waitlisted Attendances up to the number of newly available seats. Changing capacity to unlimited confirms every eligible Waitlisted Attendance for an `OPEN` Event in the same transaction; an `APPROVAL_REQUIRED` Event preserves its Organizer decision rule.

The Event `version` provides optimistic concurrency for Organizer revise, publish, and cancel commands. Those commands carry the last observed version and fail with a version conflict rather than silently overwriting a newer Event revision.

The Organizer receives a Confirmed Attendance when the Event is created. This Attendance consumes capacity when the Event is bounded, so Event creation initializes `confirmed_count` to one.

The Organizer's initial Confirmed Attendance cannot be cancelled independently of the Event. An Organizer who ends their involvement cancels the Event, keeping Event ownership and occupied capacity aligned.

### `event_locations`

```text
id                         uuid primary key
event_id                   uuid not null unique references events(id)
city                       varchar(100) not null
district                   varchar(100) not null
venue_name                 varchar(160) null
address                    text null
address_visibility         address_visibility not null default 'EVENT_VIEWERS'
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

`address_visibility`: `EVENT_VIEWERS`, `CONFIRMED_ATTENDEES`. City and district are used for discovery; the exact address is independently protected.

### `event_creation_quota_usage`

```text
user_id                    uuid not null references users(id)
period_start               date not null
created_count              integer not null default 0
monthly_event_limit        integer not null default 8 check (monthly_event_limit > 0)
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1

primary key (user_id, period_start)
```

One row represents one User's usage and applicable quota for one UTC calendar month. `monthly_event_limit` is a snapshot: it may be changed directly for that User and month without affecting other Users. The first row for a month defaults to eight; a future entitlement or package model can instead provide the value when the row is created.

A User may read only their own current calendar-month quota: `created_count`, `monthly_event_limit`, and their derived remaining count. They cannot change it. Historical quota views and a management interface are outside the MVP.

## Attendance and invitations

### `attendances`

```text
id                         uuid primary key
event_id                   uuid not null references events(id)
user_id                    uuid not null references users(id)
status                     attendance_status not null
waitlist_opt_in            boolean not null default false
requested_at               timestamptz not null
waitlisted_at              timestamptz null
confirmed_at               timestamptz null
rejected_at                timestamptz null
rejection_reason           varchar(300) null
cancelled_at               timestamptz null
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1

unique (event_id, user_id)
```

`attendance_status`: `PENDING`, `CONFIRMED`, `WAITLISTED`, `REJECTED`, `CANCELLED`.

Only `CONFIRMED` consumes capacity. `waitlist_opt_in` records permission to move an approval request to the waitlist if capacity is unavailable when the Organizer acts. A direct waitlist enrollment must be an explicit user action.

No new Attendance, approval, or waitlist promotion is permitted at or after `events.starts_at`. Before that time, an `OPEN` Event automatically promotes the oldest eligible Waitlisted Attendance after a seat is released. For an `APPROVAL_REQUIRED` Event, the oldest eligible Waitlisted Attendance remains Waitlisted until the Organizer confirms it; confirmation still applies the ordinary capacity check.

A User may make a fresh request after cancelling their own Attendance; the same record is evaluated again under the current Join Policy and capacity. An Organizer rejection prevents another ordinary request for that Event. If the Organizer later changes their mind, a valid Invitation creates the explicit route back into the ordinary attendance and capacity decision flow. `rejection_reason` is optional and visible only to the Organizer and the affected User.

### `invitations`

```text
id                         uuid primary key
event_id                   uuid not null references events(id)
recipient_user_id          uuid not null references users(id)
invited_by_user_id         uuid not null references users(id)
status                     invitation_status not null default 'PENDING'
expires_at                 timestamptz null
accepted_at                timestamptz null
declined_at                timestamptz null
revoked_at                 timestamptz null
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1

unique (event_id, recipient_user_id)
```

`invitation_status`: `PENDING`, `ACCEPTED`, `DECLINED`, `REVOKED`, `EXPIRED`.

An Invitation grants eligibility to join; it never reserves capacity or creates a second Attendance. Expiry or revocation prevents acceptance only while the Invitation is pending. Once accepted, a later expiry or revocation never changes the resulting Attendance.

## Media

### `media_assets`

```text
id                         uuid primary key
owner_user_id              uuid not null references users(id)
storage_key                varchar(512) not null unique
mime_type                  varchar(100) not null
byte_size                  integer not null
width                      integer null
height                     integer null
status                     media_status not null default 'PENDING'
rejection_reason           varchar(300) null
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
deleted_at                 timestamptz null
deleted_by_user_id         uuid null references users(id)
version                    integer not null default 1
```

`media_status`: `PENDING`, `PROCESSING`, `READY`, `REJECTED`, `DELETED`.

The PostgreSQL row never stores file bytes. The MVP accepts only validated `image/jpeg`, `image/png`, and `image/webp` files up to 10 MB, stored on a local Docker volume under the generated `storage_key`. The implementation verifies the real image metadata rather than trusting the supplied MIME type, then creates the asset as `READY` synchronously. `PENDING` and `PROCESSING` remain lifecycle states for a later asynchronous processor; video, animated media, file conversion, S3/CDN delivery, and presigned upload are outside the MVP. Only `READY` assets may be attached or displayed. A Media Asset can become `DELETED` only after it is detached from every Profile and Event Media record.

### `event_media`

```text
id                         uuid primary key
event_id                   uuid not null references events(id)
media_asset_id             uuid not null references media_assets(id)
role                       event_media_role not null
position                   integer not null default 0
alt_text                   varchar(250) null
added_by_user_id           uuid not null references users(id)
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1

unique (event_id, media_asset_id)
```

`event_media_role`: `COVER`, `GALLERY`. A partial unique index permits at most one `COVER` record per Event. An Event has at most one Cover and five Gallery records. Only an Organizer may attach their own `READY` Media Asset to their Event.

Media bytes are served through an authorization-aware application endpoint, never by exposing an unrestricted storage URL. Avatar access follows Profile visibility; Event Media follows the parent Event's visibility and access rule. Public Event Media is anonymously viewable, Unlisted Event Media requires normal share access, and Private Event Media requires the same authorized access as the Event. Replacing a Profile avatar only changes `profiles.avatar_media_asset_id`; the previous asset remains ready and reusable. Setting a new Cover atomically replaces the existing Cover record for that Event without deleting the old asset.

## Notifications

### `notifications`

```text
id                         uuid primary key
recipient_user_id          uuid not null references users(id)
type                       notification_type not null
payload                    jsonb not null
deduplication_key          varchar(200) not null unique
read_at                    timestamptz null
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

`notification_type` begins with `ATTENDANCE_REQUESTED`, `ATTENDANCE_CONFIRMED`, `ATTENDANCE_REJECTED`, `ATTENDANCE_WAITLISTED`, `ATTENDANCE_PROMOTED`, `INVITATION_RECEIVED`, `INVITATION_REVOKED`, `EVENT_REVISED`, and `EVENT_CANCELLED`. Its JSON payload holds presentation data and the target `eventId` only; it is not a second source of truth for an Event or Attendance. `deduplication_key` is deterministic per recipient and committed domain event, preventing duplicate RabbitMQ delivery from creating duplicate notifications. Different committed Event revisions create separate Notifications; only duplicate delivery is deduplicated. The MVP retains Notification rows without automatic deletion; a User may mark one or all of their rows read.

## Required indexes

```text
events(status, visibility, starts_at)
events(category_id, starts_at)
event_locations(city, district, event_id)
attendances(event_id, status, waitlisted_at)
attendances(user_id, status)
invitations(recipient_user_id, status)
event_media(event_id, role, position)
notifications(recipient_user_id, read_at, created_at desc)
notifications(deduplication_key)
media_assets(owner_user_id, status)
```

## Transaction boundaries

- Event creation locks or upserts `event_creation_quota_usage`, verifies `created_count < monthly_event_limit`, and atomically writes a complete Draft Event, its Location, the Organizer's Confirmed Attendance, `confirmed_count = 1`, and the incremented usage count.
- RSVP, approval, cancellation, and waitlist promotion lock the target Event, update one or more `attendances`, and synchronize `confirmed_count` in one transaction.
- Invitation acceptance verifies the invitation then enters the same attendance and capacity decision flow.
- RabbitMQ publication starts only after a committed transaction; the MVP has no delivery outbox. A publish failure is logged and never rolls back canonical state, so Notification/Socket distribution can be delayed or missed until a later User query.
