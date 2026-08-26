---
title: Publish attendance events after commit
impact: HIGH
tags: rabbitmq, events, reliability
---

Publish named events such as `rsvp.created`, `rsvp.approved`, `rsvp.cancelled`, and `waitlist.promoted` only after the transaction commits. Messages contain stable identifiers and persisted state needed by consumers; consumers must be idempotent because broker delivery can repeat.

For this MVP, log and surface publish failures while PostgreSQL remains authoritative. Add an outbox pattern only when reliable delivery is a stated requirement.
