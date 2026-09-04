# Participation design

## Purpose

`participation` records what happened on the event day without changing an Attendance response or event capacity. `attendance` remains the owner of RSVP and seats; `participation` owns immutable Check-in records and derived Participation Outcomes.

## Interface

```ts
type ParticipationCommand =
  | { kind: 'RECORD_CHECK_IN'; eventId: string; attendanceId: string; actorUserId: string }
  | { kind: 'FINALIZE_DUE_PARTICIPATION' };
```

`RECORD_CHECK_IN` is available only to the Event Organizer for a `CONFIRMED` Attendance, from thirty minutes before the Event begins until two hours after it ends. The initial release records the manual organizer method; QR check-in can become another method without changing the core model.

## Persistence and invariants

- `check_in_records` is append-only. A `CHECKED_IN` row is never updated or deleted. The schema reserves `REVOKED`, which would be a separate record referencing the original Check-in.
- At most one `CHECKED_IN` record exists per Attendance. The database enforces this with a partial unique index, so concurrent requests cannot create duplicates.
- `participation_outcomes` is append-only and contains at most one derived result per Event and Attendance.
- Once the two-hour late check-in window closes, the scheduler derives `ATTENDED` for confirmed Attendances with a Check-in and `NO_SHOW` for every other confirmed Attendance. Cancellation creates neither result.

Attendance is therefore a pre-event commitment, while Participation Outcome is a post-event fact. Ratings and refunds can later authorize against `ATTENDED` without overloading either concept.
