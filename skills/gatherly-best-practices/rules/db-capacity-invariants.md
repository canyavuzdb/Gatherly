---
title: Treat confirmed attendance as the capacity source
impact: CRITICAL
tags: capacity, attendance, database
---

Only `CONFIRMED` attendance occupies capacity. `PENDING` and `WAITLISTED` records do not. Enforce one attendance record per `(eventId, userId)` with a database constraint. Keep `confirmedCount` synchronized with confirmed records and never accept it from a client payload.

When a confirmed attendee leaves, promote the oldest eligible waitlisted attendee in the same transaction before publishing side effects.
