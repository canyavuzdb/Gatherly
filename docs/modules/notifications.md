# Notifications, messaging, and realtime design

This document defines how Gatherly distributes committed facts without giving RabbitMQ, Socket.IO, or Notifications authority over Event, Attendance, or Invitation state.

## 1. Purpose and ownership

Three deep modules divide distribution work by responsibility:

| Module | Owns | Does not own |
| --- | --- | --- |
| `messaging` | committed-fact envelope, RabbitMQ publication and consumption lifecycle, publish-failure logging | Event, Attendance, Invitation, or Notification truth |
| `notifications` | in-app Notification derivation, persistence, deduplication, list/read state | source Event/Attendance/Invitation state or external delivery |
| `realtime` | authenticated Socket.IO connections, room choice, compact re-fetch signals | business decisions, room-specific data projection, share-token access |

Business modules commit canonical PostgreSQL state first. Only after commit do they ask `messaging` to distribute a `CommittedFact`. A published fact may produce a Notification, a User signal, a Public Event signal, or no visible result. No consumer may change Attendance capacity, Event lifecycle, or Invitation eligibility.

## 2. Committed-fact envelope and messaging interface

Every source module builds facts from its committed result. Facts use versioned names and a stable envelope:

```ts
export type CommittedFact = {
  messageId: MessageId;
  eventName: string;
  eventVersion: 1;
  occurredAt: Instant;
  correlationId: CorrelationId;
  causationId?: CausationId;
  payload: Readonly<Record<string, unknown>>;
};

export interface MessagingModule {
  publish(facts: readonly CommittedFact[]): Promise<void>;
}
```

`publish` is called only after a successful business transaction. It hides RabbitMQ exchange, routing key, serialization, confirms, consumer acknowledgement, and failure logging. A RabbitMQ publish failure is logged but does not reinterpret or roll back the committed decision. The MVP intentionally has no transactional outbox, replay worker, or reconciliation job.

Relevant fact names begin with:

```text
attendance.pending.v1
attendance.confirmed.v1
attendance.rejected.v1
attendance.waitlisted.v1
attendance.promoted.v1
attendance.cancelled.v1
invitation.received.v1
invitation.revoked.v1
event.revised.v1
event.cancelled.v1
event.capacity.changed.v1
```

The facts contain only data their consumers need to derive a Notification or a compact re-fetch signal. They never contain a password, refresh secret, share token, exact storage key, roster, or a replacement for canonical Event/Attendance rows.

## 3. Notification interface

The `notifications` module has two browser-facing operations and one RabbitMQ-consumer entry point.

```ts
export interface NotificationModule {
  list(request: ListNotifications): Promise<NotificationPage>;
  decide(command: NotificationCommand): Promise<NotificationOutcome>;
  consume(delivery: NotificationDelivery): Promise<NotificationConsumption>;
}

export type ListNotifications = {
  actor: UserIdentity;
  before?: NotificationCursor;
  limit?: number;
};

export type NotificationCommand =
  | {
      kind: 'MARK_NOTIFICATION_READ';
      actor: UserIdentity;
      notificationId: NotificationId;
    }
  | {
      kind: 'MARK_ALL_NOTIFICATIONS_READ';
      actor: UserIdentity;
    };

export type NotificationItem = {
  id: NotificationId;
  type: NotificationType;
  payload: {
    eventId: EventId;
    title: string;
    body: string;
  };
  readAt: Instant | null;
  createdAt: Instant;
};

export type NotificationPage = {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor?: NotificationCursor;
};
```

The default page limit is twenty and the maximum is fifty. Results sort by `created_at DESC, id DESC`; the cursor is opaque. `unreadCount` is a query-time observation, not a separate mutable counter.

`NotificationItem.payload` is presentation text and a target `eventId` only. Opening it re-fetches authorized Event detail or the Personal Calendar; the Notification never stores a stale Event or Attendance snapshot as business truth.

## 4. Notification derivation and idempotency

The consumer maps only these committed facts to recipient-facing Notification rows:

| Fact | Recipient | Notification type |
| --- | --- | --- |
| `attendance.pending.v1` | Event Organizer | `ATTENDANCE_REQUESTED` |
| `attendance.confirmed.v1` | affected User when another actor confirms it | `ATTENDANCE_CONFIRMED` |
| `attendance.rejected.v1` | affected User | `ATTENDANCE_REJECTED` |
| `attendance.waitlisted.v1` | affected User when an Organizer decision moves it to the waitlist | `ATTENDANCE_WAITLISTED` |
| `attendance.promoted.v1` | affected User | `ATTENDANCE_PROMOTED` |
| `invitation.received.v1` | Invitation recipient | `INVITATION_RECEIVED` |
| `invitation.revoked.v1` | former Invitation recipient | `INVITATION_REVOKED` |
| `event.revised.v1` | active attendees | `EVENT_REVISED` |
| `event.cancelled.v1` | active attendees | `EVENT_CANCELLED` |

The User who initiated their own RSVP, Event revision, or Event cancellation does not receive a redundant Notification. Therefore direct Open RSVP and direct Waitlist Enrollment create no Notification for their caller; an Organizer decision and automatic promotion can notify the affected attendee. Event publication, Event completion, registration, sign-in, and ordinary Attendance cancellation produce none in the MVP.

For each recipient, the implementation derives:

```text
deduplication_key = deterministic(recipient_user_id, message_id)
```

The unique database constraint makes repeated RabbitMQ delivery produce one Notification row. Distinct committed Event revisions have distinct `messageId` values and therefore produce distinct rows; the MVP does not coalesce them.

Consumer order is fixed:

```text
receive and validate RabbitMQ delivery
derive recipients and presentation payload
insert Notification rows with unique deduplication keys
commit Notification transaction
emit recipient re-fetch signal
acknowledge delivery
```

If a consumer fails before acknowledgement, RabbitMQ may redeliver. A duplicate row is harmless; emitting a second re-fetch signal is also harmless. A persisted Notification always precedes its Socket signal.

## 5. Read-state rules

`MARK_NOTIFICATION_READ` may change only the caller's own row. Already-read rows return the same committed outcome. `MARK_ALL_NOTIFICATIONS_READ` updates whatever rows are unread for that User at its transaction time; an empty set is a successful no-op. A missing row and another User's row both return `NOTIFICATION_NOT_FOUND_OR_NOT_OWNED`, avoiding cross-User existence disclosure.

Notification rows are retained in the MVP. There is no automatic retention job, email, push notification, preference center, or Notification-triggered business action.

## 6. Realtime interface and rooms

`realtime` accepts only compact facts; it chooses rooms internally.

```ts
export interface RealtimeModule {
  emit(signal: CommittedRealtimeSignal): Promise<void>;
}

export type CommittedRealtimeSignal =
  | { kind: 'NOTIFICATIONS_CHANGED'; recipientUserId: UserId }
  | {
      kind: 'USER_EVENT_CHANGED';
      recipientUserId: UserId;
      eventId: EventId;
      change: 'ATTENDANCE' | 'INVITATION' | 'EVENT';
    }
  | {
      kind: 'PUBLIC_EVENT_CHANGED';
      eventId: EventId;
      change: 'EVENT' | 'CAPACITY';
    };
```

The Socket.IO adapter maps those signals as follows:

- `user:{userId}` is available only after an authenticated socket connection. It receives Notification, Attendance, Invitation, and private-access signals for that User.
- `event:{eventId}` exists only for an Event that is currently Public. It receives only a Public Event or capacity change signal.
- Unlisted and Private Event changes never enter a shared Event room. They target affected authenticated User rooms instead.
- A share token is never accepted in a Socket handshake, room join, or signal payload.

Signals contain no roster, Event detail, Attendance state, address, share token, or Notification body. The browser uses each signal to re-fetch the normal authorized query projection. Disconnection, duplication, reordering, or absence of Socket signals therefore cannot make PostgreSQL truth wrong.

## 7. Adapters and internal seams

RabbitMQ and Socket.IO are remote-but-owned dependencies, so both have real adapter seams:

| Seam | Production adapter | Test adapter |
| --- | --- | --- |
| committed fact publisher/consumer | RabbitMQ adapter | recording delivery adapter |
| realtime signal emission | Socket.IO adapter | recording signal adapter |

PostgreSQL persistence remains private to the Notification implementation. A generic repository interface would have one meaningful adapter today and would make the design shallower. The RabbitMQ consumer adapter validates/decodes an envelope and calls `notifications.consume`; it does not derive recipients, generate deduplication keys, write rows, or name rooms.

## 8. Business failures and verification

```text
AUTHENTICATION_REQUIRED
INVALID_NOTIFICATION_CURSOR
INVALID_PAGE_LIMIT
NOTIFICATION_NOT_FOUND_OR_NOT_OWNED
UNSUPPORTED_COMMITTED_FACT
```

RabbitMQ, Socket.IO, and PostgreSQL availability problems remain exceptional infrastructure failures. A source command remains successful after its transaction commits even when later RabbitMQ distribution fails.

The key tests are:

1. A duplicate RabbitMQ delivery creates one Notification row and never changes business state.
2. Two distinct Event revisions create two Notification rows.
3. Notification persistence completes before its User signal emits.
4. A User cannot read or mark another User's Notification.
5. Mark-one and mark-all are idempotent; paging remains stable on a fixed dataset.
6. RabbitMQ publication happens after, never before, the source transaction commits; a failure is logged and does not roll back truth.
7. Public Event signals use only public Event rooms; Unlisted/Private facts produce only affected User signals.
8. Reconnecting or missing a Socket signal is recoverable by ordinary Notification/Event queries.

## 9. Implementation map

```text
apps/api/src/messaging/
  messaging.module.ts
  messaging.interface.ts
  messaging.events.ts
  rabbitmq.adapter.ts
  recording.adapter.ts

apps/api/src/notifications/
  notifications.module.ts
  notifications.interface.ts
  notifications.commands.ts
  notifications.projections.ts
  notifications.errors.ts
  notifications.implementation.ts
  notifications.persistence.ts
  notifications.consumer.ts
  notifications.http.ts
  notifications.integration-spec.ts

apps/api/src/realtime/
  realtime.module.ts
  realtime.interface.ts
  realtime.implementation.ts
  socketio.adapter.ts
  recording.adapter.ts
```

This is a responsibility map, not a mandate for shallow forwarding files. The depth comes from concentrating routing, deduplication, persistence ordering, and access-safe signaling behind small interfaces.

## 10. Related documents

- [System design](../architecture/system.md)
- [Application architecture](../architecture/application.md)
- [Attendance design](./attendance.md)
- [Event design](./events.md)
- [Event discovery design](./event-discovery.md)
- [Data model](../architecture/data-model.md)
- [Domain glossary](../domain-glossary.md)
