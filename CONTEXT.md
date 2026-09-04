# Gatherly domain glossary

## Attendance response

A member's current response to an event. `CONFIRMED`, `PENDING`, and `WAITLISTED` are active participation states. `CANCELLED` means the member has declined or withdrawn but may make a new request later. `REJECTED` is an organiser's final rejection.

## Maybe response

`MAYBE` is a deliberate, reversible attendance response. It neither reserves capacity nor places a member on the waitlist or attendee list. The organiser can see members with this response as **Belkiler**; members can later request attendance, including the waitlist when the event is full.

## Event completion

**Check-in**:
An immutable record that a confirmed member arrived at an event. It is evidence of arrival, not an Attendance response or a capacity decision.
_Avoid_: Attendance, RSVP

**Participation outcome**:
The final, derived outcome for an eligible member once an event ends, such as `ATTENDED` or `NO_SHOW`. It is distinct from the member's earlier Attendance response.
_Avoid_: Attendance status, RSVP status

## Feedback

**Review**:
An attendee's versioned evaluation of either an Event or its Organizer after attending. A newer Review supersedes a prior one without deleting it.
_Avoid_: Rating record, review update
