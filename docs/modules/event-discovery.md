# Event discovery design

This document applies the [application architecture](../architecture/application.md) pattern to read-only Event Discovery, authorized Event detail, and the Personal Calendar.

## 1. Purpose and ownership

The `event-discovery` module owns read projections for discovering Events, opening an Event detail, and reading the current User's Personal Calendar. It owns no Event, Attendance, Invitation, or Category state and never writes PostgreSQL, publishes RabbitMQ messages, or emits Socket.IO updates.

Its value is one place for visibility, detail authorization, privacy-aware projection, cursor ordering, and a User's own Attendance projection. The `events`, `attendance`, and `media` modules remain the owners of their respective write rules.

## 2. External interface

The module presents three named queries matching the three MVP views.

```ts
export interface EventDiscoveryModule {
  discover(request: DiscoverEvents): Promise<EventPage>;
  open(request: OpenEvent): Promise<EventDetail>;
  personalCalendar(request: PersonalCalendar): Promise<CalendarPage>;
}

export type Viewer = UserIdentity | null;

export type DiscoverEvents = {
  viewer: Viewer;
  city: string;
  district?: string;
  categoryId?: CategoryId;
  startsAtFrom?: Instant;
  startsAtBefore?: Instant;
  after?: DiscoveryCursor;
  limit?: number;
};

export type OpenEvent = {
  viewer: Viewer;
  eventId: EventId;
  shareToken?: string;
};

export type PersonalCalendar = {
  actor: UserIdentity;
  after?: CalendarCursor;
  limit?: number;
};
```

`Viewer` is a trusted context produced by the HTTP adapter after `auth.authenticate`; no caller may nominate an arbitrary User identifier. `DiscoveryCursor` and `CalendarCursor` are opaque values produced and interpreted by the implementation, never a client-supplied offset or raw database tuple.

## 3. Projections

```ts
export type CapacityView =
  | { kind: 'UNLIMITED' }
  | {
      kind: 'LIMITED';
      capacity: number;
      confirmedCount: number;
      availableSeats: number;
    };

export type EventCard = {
  id: EventId;
  title: string;
  startsAt: Instant;
  endsAt: Instant;
  timezone: string;
  status: 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  category: { id: CategoryId; name: string; isActive: boolean };
  location: { city: string; district: string; venueName: string | null };
  capacity: CapacityView;
  ownAttendanceStatus?: AttendanceStatus;
  coverMediaAssetId?: MediaAssetId;
};

export type EventPage = {
  items: EventCard[];
  nextCursor?: DiscoveryCursor;
  activeCategories: Array<{ id: CategoryId; name: string }>;
};

export type EventDetail = EventCard & {
  description: string;
  visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  joinPolicy: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';
  location: EventCard['location'] & { address: string | null };
  galleryMediaAssetIds: MediaAssetId[];
  joinAvailable: boolean;
};

export type CalendarEventCard = Omit<EventCard, 'status'> & {
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  relationship: 'ORGANIZER' | 'ATTENDEE';
};

export type CalendarPage = {
  items: CalendarEventCard[];
  nextCursor?: CalendarCursor;
};
```

No projection exposes a roster, another User's Attendance, an Invitation, a rejection reason, a share token, an exact storage key, or an ORM record. `availableSeats` is an observation from `confirmed_count`, never a reservation. `UNLIMITED` makes the capacity representation unambiguous.

## 4. General Event Discovery

`discover` reads Public Events satisfying all of these conditions:

```text
visibility = PUBLIC
city = requested city
```

`scope = UPCOMING` (the default) adds `status = PUBLISHED` and `starts_at > current time`. `scope = PAST` returns completed and cancelled Public plans. The web view can use the permitted coordinates for map markers; this is a presentation of discovered Events, not radius or location-ranking search.

District, Category, and half-open start-time range filters are optional. `city` is required; a range with `startsAtFrom >= startsAtBefore` is invalid. The default limit is twenty and the maximum is fifty.

Results sort by `starts_at ASC, id ASC`. A cursor binds the last tuple and the normalized filter context. It cannot be reused for a different filter set. PostgreSQL applies the corresponding tuple condition, so offset drift is avoided. This is not a snapshot: a new Event, a cancellation, or time passing may change a later page, but every page reflects committed current truth.

The page includes only active Categories for the filter UI. An existing Event with an inactive Category still appears in a city result and exposes that Category on its card; it simply cannot be chosen as a new filter.

When a Viewer is present, the list query conditionally projects only that Viewer's Attendance status. An authorized Event detail may project a roster: the Organizer sees confirmed participants, and confirmed participants see presentation data according to each Profile's visibility setting.

The current scope excludes title/description search, relevance ranking, radius search, recommendations, cache, and a separate search index.

## 5. Event detail and privacy

`open` evaluates access before it projects data.

| Event state | Who may open it |
| --- | --- |
| Public (`PUBLISHED`, `CANCELLED`, or `COMPLETED`) | anyone |
| Unlisted | valid share token, Organizer, or User with active Attendance |
| Private | Organizer, User with active Attendance, or recipient of a pending Invitation |
| Draft | Organizer only |

An active Attendance is `CONFIRMED`, `PENDING`, or `WAITLISTED`. Changing an Event's access rule does not remove detail access that an existing active Attendance grants. A pending Invitation is revoked on cancellation, so it ceases to grant Private access then.

The exact address is a separate projection rule:

- `EVENT_VIEWERS`: returned to anyone who may open the Event;
- `CONFIRMED_ATTENDEES`: returned only to the Organizer or a Confirmed Attendance holder;
- otherwise: `address` is `null`.

`joinAvailable` is false for Cancelled, Completed, started, or otherwise non-joinable Events. It indicates eligibility to attempt a join, never a guaranteed seat. A Public Event remains directly viewable after cancellation or completion, preserving a shared link with a status label while offering no join action.

Missing and unauthorized Event detail requests both return `EVENT_NOT_FOUND_OR_NOT_VIEWABLE`; the implementation does not disclose whether a Private or Unlisted Event exists.

## 6. Personal Calendar

`personalCalendar` requires an authenticated active User and returns Event entries ordered by `starts_at ASC, id ASC`, with a default limit of twenty and maximum of fifty. Its `UPCOMING` and `PAST` scopes follow the same product distinction as discovery.

It combines:

- Events the User organizes in `DRAFT`, `PUBLISHED`, `CANCELLED`, or `COMPLETED` state;
- Events where the User has `CONFIRMED`, `PENDING`, or `WAITLISTED` Attendance.

An Event appearing through both paths occurs once, with `relationship = ORGANIZER`. Cancelled and completed entries remain readable as history.

## 7. Implementation and dependencies

PostgreSQL is the sole data dependency and remains inside the implementation. There is no repository, cache, search, or read-replica seam today: each would be hypothetical and reduce locality.

The implementation hides joined read projections across `events`, `event_locations`, `categories`, `attendances`, `invitations`, `event_media`, and `media_assets`; conditional own-Attendance joins; visibility and address checks; cursor encoding/validation; and capacity derivation. Its existing indexes support the MVP query paths:

```text
events(status, visibility, starts_at)
events(category_id, starts_at)
event_locations(city, district, event_id)
attendances(user_id, status)
event_media(event_id, role, position)
```

Clock access and cursor encoding are internal seams for deterministic tests. No client learns or depends on their implementation.

## 8. Business failures

```text
AUTHENTICATION_REQUIRED
INVALID_DISCOVERY_FILTER
INVALID_DISCOVERY_CURSOR
INVALID_PAGE_LIMIT
EVENT_NOT_FOUND_OR_NOT_VIEWABLE
```

Expected failures are part of the interface. PostgreSQL faults remain exceptional. Each query is idempotent and read-only; a later retry may naturally observe newer committed Event or Attendance state.

## 9. Integration-test contract

The EventDiscoveryModule interface is the test surface. PostgreSQL integration tests must prove:

1. Upcoming Discovery excludes Draft, Unlisted, Private, Cancelled, Completed, and started Events; Past Discovery returns eligible completed and cancelled Public Events.
2. Required city and optional district, Category, and date filters give only matching results in `starts_at, id` order.
3. Cursor paging has no duplicates on a stable dataset and rejects cursors from another filter context.
4. An inactive Category appears on its existing Event card but not in `activeCategories`.
5. A list Viewer sees only their own Attendance status; roster data is returned only in authorized detail according to Organizer, Attendance, and Profile visibility rules.
6. Public detail remains readable after cancellation/completion but has no join action.
7. Unlisted and Private access succeeds only through their stated rules, while denied and missing detail are indistinguishable.
8. Address projection distinguishes Event viewers from Confirmed Attendance holders.
9. Personal Calendar unifies Organizer and Attendance paths, deduplicates an Organizer's initial Attendance, and separates Upcoming from preserved history.

## 10. Implementation map

```text
apps/api/src/event-discovery/
  event-discovery.module.ts
  event-discovery.interface.ts
  event-discovery.projections.ts
  event-discovery.errors.ts
  event-discovery.implementation.ts
  event-discovery.http.ts
  event-discovery.integration-spec.ts
```

This is a responsibility map, not a mandate for shallow forwarding files. The module's depth comes from keeping privacy-aware Event reads, cursor semantics, and Viewer-specific projections in one implementation.

## 11. Related documents

- [System design](../architecture/system.md)
- [Application architecture](../architecture/application.md)
- [Event design](./events.md)
- [Attendance design](./attendance.md)
- [Media design](./media.md)
- [Data model](../architecture/data-model.md)
- [Domain glossary](../domain-glossary.md)
