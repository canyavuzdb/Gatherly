---
name: gatherly-best-practices
description: Plan, implement, or review Gatherly backend features that affect events, attendance, authorization, PostgreSQL transactions, RabbitMQ, Socket.IO, or local Docker services. Use alongside general NestJS guidance; it contains Gatherly-specific rules only.
license: MIT
metadata:
  version: "0.1.0"
---

# Gatherly best practices

Use this skill for Gatherly domain changes. It is not a general NestJS style guide and does not replace framework documentation.

## When to apply

- Creating or changing event, attendance, invitation, notification, or account behavior.
- Adding an API endpoint that reads or mutates private event data.
- Publishing or consuming RabbitMQ messages.
- Emitting Socket.IO updates about attendance or capacity.
- Reviewing a PR that affects the local Docker Compose stack.

## Rule categories

| Priority | Category | Rules |
|---|---|---|
| Critical | Attendance consistency | `db-transactional-rsvp`, `db-capacity-invariants` |
| Critical | Access control | `security-event-ownership`, `api-visibility` |
| High | Messaging and realtime | `messaging-after-commit`, `realtime-persisted-state` |
| High | Architecture | `arch-feature-boundaries` |
| Medium | Tests | `test-rsvp-concurrency` |
| Medium | Local operations | `devops-local-compose` |

Read only the rule files relevant to the requested change. For a feature that changes RSVP behavior, read both attendance, access-control, messaging, realtime, and test rules.

## Completion note

State the affected domain transition, transaction boundary, authorization rule, emitted event, realtime effect, and verification performed.
