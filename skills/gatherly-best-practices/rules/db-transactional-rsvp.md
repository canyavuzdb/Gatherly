---
title: Make RSVP decisions in one transaction
impact: CRITICAL
tags: postgresql, transaction, rsvp, waitlist
---

For RSVP, approval, cancellation, and waitlist promotion, lock the target event row in one PostgreSQL transaction. Check existing attendance, join policy, capacity, write the attendance state, and update `confirmedCount` in that same transaction.

A read-then-write flow outside a transaction is invalid because two users can both claim the final seat.
