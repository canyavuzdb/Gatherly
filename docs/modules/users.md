# Users and Profile design

This document applies the [application architecture](../architecture/application.md) pattern to Profile editing, visibility-aware Profile reads, and a User's Event Creation Quota view.

## 1. Purpose and ownership

The `users` module owns Profile presentation and edit rules plus the meaning and current-month projection of Event Creation Quota. It does not own credentials, Media Asset lifecycle, Event creation, Attendance decisions, or quota assignment through a browser-facing operation.

`auth` atomically creates the initial Profile at registration. `media` owns avatar asset selection and deletion. `events` owns the Event-creation transaction and calls a trusted internal quota seam inside that transaction. The `users` module owns the quota rule and read projection, while `events` preserves the atomic Event/Location/Organizer Attendance/quota write.

## 2. External interface

The module exposes the three real MVP needs directly.

```ts
export interface UsersModule {
  reviseMyProfile(command: ReviseMyProfile): Promise<OwnProfileView>;
  openProfile(query: OpenProfile): Promise<ProfileView>;
  currentEventCreationQuota(query: CurrentEventCreationQuota): Promise<QuotaView>;
}

export type ReviseMyProfile = {
  actor: UserIdentity;
  expectedVersion: number;
  firstName: string;
  lastName: string;
  bio: string | null;
  visibility: 'PUBLIC' | 'EVENT_ATTENDEES' | 'PRIVATE';
};

export type OpenProfile = {
  viewer: UserIdentity | null;
  subjectUserId: UserId;
  decisionContext?: {
    eventId: EventId;
    purpose: 'ATTENDANCE_DECISION';
  };
};

export type CurrentEventCreationQuota = {
  actor: UserIdentity;
};

export type ProfileView = {
  userId: UserId;
  firstName: string;
  lastName: string;
  bio: string | null;
  avatar: { mediaAssetId: MediaAssetId } | null;
};

export type OwnProfileView = ProfileView & {
  visibility: 'PUBLIC' | 'EVENT_ATTENDEES' | 'PRIVATE';
  version: number;
};

export type QuotaView = {
  periodStart: LocalDate;
  createdCount: number;
  monthlyEventLimit: number;
  remainingCount: number;
};
```

`UserIdentity` is trusted context from `auth.authenticate`, never a client-chosen User id. `ProfileView` excludes visibility and version for a different User; it also excludes email, Event/Attendance history, Notification, quota, and security data. The avatar is an opaque candidate reference; Media still authorizes the byte delivery independently.

## 3. Profile editing

`reviseMyProfile` permits an active User to edit their own Profile even before email verification. It accepts the complete editable Profile definition rather than an ORM-shaped patch:

```text
first_name: trim, nonblank, maximum 100 characters
last_name:  trim, nonblank, maximum 100 characters
bio:        null or maximum 500 characters
visibility: PUBLIC | EVENT_ATTENDEES | PRIVATE
```

Whitespace-only bio normalizes to `null`. The update matches `expectedVersion` and increments `profiles.version` in the same transaction. A stale browser form returns `PROFILE_VERSION_CONFLICT` instead of silently overwriting another edit. Changing visibility applies immediately to all future Profile and avatar reads.

The User name has no separate username, social-link, phone, or email-presentation field in the MVP. Avatar changes use `media.decide(SET_PROFILE_AVATAR)`, not this interface.

## 4. Profile visibility

`openProfile` evaluates the current rule before producing any Profile or avatar reference.

| Profile visibility | Who may open it |
| --- | --- |
| `PUBLIC` | anyone, including an anonymous viewer |
| `EVENT_ATTENDEES` | the subject; an Organizer evaluating that User's Attendance request; or a User who shares an Event where both have Confirmed Attendance |
| `PRIVATE` | the subject, plus the Organizer decision exception |

The Organizer decision exception requires all of the following, verified by the implementation:

1. The Viewer is the immutable Organizer of `decisionContext.eventId`.
2. The subject has a decision-relevant Attendance in that Event (`PENDING` or `WAITLISTED`).
3. The query purpose is `ATTENDANCE_DECISION`.

The implementation never returns which shared Event established `EVENT_ATTENDEES` access. A Profile that is missing, deleted, or not visible produces the same `PROFILE_NOT_FOUND_OR_NOT_VIEWABLE` outcome.

Avatar byte delivery re-evaluates the same current Profile access rule inside `media.open`; the `mediaAssetId` in a Profile response is not an access grant. Self-deletion makes the Profile private, removes its avatar/bio, and prevents a normal visible Profile projection.

## 5. Event Creation Quota

Quota periods are UTC calendar months. The current-period query is read-only:

```text
periodStart        first day of current UTC month
createdCount       event_creation_quota_usage.created_count
monthlyEventLimit  event_creation_quota_usage.monthly_event_limit
remainingCount     max(monthlyEventLimit - createdCount, 0)
```

If no row exists for the current UTC month, the query returns `0 / 8 / 8` without creating one. A User may read only their own current period. There is no historical quota view, User-facing limit change, or quota management screen.

Event creation uses an internal `users` seam inside the Event transaction:

```ts
consumeCreationQuotaInEventTransaction({
  organizerId: UserId,
  utcMonthStart: LocalDate,
  transaction: Transaction,
}): QuotaView;
```

It locks or creates the row, checks `created_count < monthly_event_limit`, increments only on successful Draft creation, and returns `EVENT_CREATION_QUOTA_EXHAUSTED` otherwise. This is inaccessible to HTTP adapters. The limit is a per-User/month snapshot: a direct database adjustment affects only that row and month.

## 6. Internal implementation and seams

PostgreSQL is the sole persistence dependency and remains in the implementation. It hides Profile optimistic updates, `EVENT_ATTENDEES` existence checks, Organizer decision checks, Profile deletion state, quota default derivation, and the quota lock/upsert operation.

The module has narrow internal collaboration seams only where ownership genuinely varies:

- `events` invokes quota consumption within its already-owned creation transaction;
- `media` reuses the Profile access decision when serving an avatar.

Neither seam exposes a generic repository, a storage key, or a public way to bypass Profile visibility. There are no message, Socket.IO, cache, or external-provider adapters in this module.

## 7. Business failures and integration tests

```text
ACTOR_NOT_ACTIVE
INVALID_PROFILE_NAME
BIO_TOO_LONG
PROFILE_VERSION_CONFLICT
PROFILE_NOT_FOUND_OR_NOT_VIEWABLE
EVENT_CREATION_QUOTA_EXHAUSTED
```

The key integration tests prove:

1. Registration creates the required default Profile atomically with the User.
2. Unverified active Users can revise their Profile; inactive or deleted Users cannot.
3. Invalid names/bios are rejected and a stale version cannot overwrite a newer Profile.
4. Public, Event Attendees, Private, Organizer decision, deleted-Profile, and anonymous reads produce exactly their allowed projections.
5. A returned avatar reference never bypasses Media's later authorization check.
6. A no-row current quota view returns the default UTC-month `0 / 8 / 8` without a write.
7. Concurrent last-slot Event creation consumes one quota slot and creates one Draft.
8. A User cannot read or change another User's quota through the product.

## 8. Implementation map

```text
apps/api/src/users/
  users.module.ts
  users.interface.ts
  users.commands.ts
  users.projections.ts
  users.errors.ts
  users.implementation.ts
  users.persistence.ts
  users.http.ts
  users.integration-spec.ts
```

This is a responsibility map, not a mandate for shallow forwarding files. The depth is in keeping Profile access, Profile versioning, and quota semantics local behind three small entry points.

## 9. Related documents

- [System design](../architecture/system.md)
- [Application architecture](../architecture/application.md)
- [Auth design](./auth.md)
- [Media design](./media.md)
- [Event design](./events.md)
- [Data model](../architecture/data-model.md)
- [Domain glossary](../domain-glossary.md)
