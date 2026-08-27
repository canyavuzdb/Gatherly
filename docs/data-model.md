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

`user_status`: `ACTIVE`, `SUSPENDED`, `DELETED`. JWT access tokens are stateless and have no table.

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

### `email_verification_tokens`

```text
id                         uuid primary key
user_id                    uuid not null references users(id)
token_hash                 text not null unique
expires_at                 timestamptz not null
used_at                    timestamptz null
created_at                 timestamptz not null
```

Only a digest of the emailed secret is stored. A token is single-use.

### `password_reset_tokens`

```text
id                         uuid primary key
user_id                    uuid not null references users(id)
token_hash                 text not null unique
expires_at                 timestamptz not null
used_at                    timestamptz null
created_at                 timestamptz not null
```

Only a digest of the reset secret is stored. A token is single-use.

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

An Event has one Category in the MVP. Inactive Categories remain referenced by existing Events but cannot be selected for new ones.

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

One row represents one User's usage and applicable quota for one calendar month. `monthly_event_limit` is a snapshot: it may be changed directly for that User and month without affecting other Users. The first row for a month defaults to eight; a future entitlement or package model can instead provide the value when the row is created.

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

An Invitation grants eligibility to join; it never reserves capacity or creates a second Attendance.

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

The PostgreSQL row never stores file bytes. Only `READY` assets may be attached or displayed.

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

`event_media_role`: `COVER`, `GALLERY`. A partial unique index permits at most one `COVER` record per Event. Only an Organizer may attach media to their Event.

## Notifications

### `notifications`

```text
id                         uuid primary key
recipient_user_id          uuid not null references users(id)
type                       notification_type not null
payload                    jsonb not null
read_at                    timestamptz null
created_at                 timestamptz not null
updated_at                 timestamptz not null
updated_by_user_id         uuid null references users(id)
updated_by_kind            change_actor_kind not null
version                    integer not null default 1
```

`notification_type` begins with attendance, invitation, and Event lifecycle notifications. Its JSON payload holds presentation data only; it is not a second source of truth for an Event or Attendance.

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
media_assets(owner_user_id, status)
```

## Transaction boundaries

- Event creation locks or upserts `event_creation_quota_usage`, verifies `created_count < monthly_event_limit`, and atomically writes `events`, `event_locations`, and the incremented usage count.
- RSVP, approval, cancellation, and waitlist promotion lock the target Event, update one or more `attendances`, and synchronize `confirmed_count` in one transaction.
- Invitation acceptance verifies the invitation then enters the same attendance and capacity decision flow.
- RabbitMQ publication starts only after a committed transaction; the MVP has no delivery outbox.
