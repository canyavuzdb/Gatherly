---
title: Test attendance transitions and final-seat contention
impact: HIGH
tags: testing, concurrency, rsvp
---

Cover duplicate requests, the final available seat requested concurrently, each join policy, full-capacity waitlisting, cancellation, waitlist promotion, organizer ownership, and private-event access. Assert both the response and persisted database state.

Mock RabbitMQ and Socket.IO in unit tests; use a real PostgreSQL transaction in integration coverage for capacity behavior.
