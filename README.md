# Gatherly

Gatherly is a community-driven event platform for discovering, creating, and joining local events. It is being built as a production-minded learning project around transactional RSVP flows, role-aware access control, asynchronous messaging, and real-time capacity updates.

> **Project status:** Foundation and architecture work in progress. The repository currently contains Gatherly-specific engineering skills; application code will follow.

## Why Gatherly?

An event platform is a useful real-world domain for learning how data consistency and user experience meet. A user claiming the final seat, an organizer approving a request, or a cancellation promoting a waitlisted attendee must remain correct even when requests arrive simultaneously.

## Planned MVP

- Public event discovery in list and calendar views
- City, district, date, and category filters
- User registration, login, and JWT authentication
- Event creation and editing
- `Public`, `Unlisted`, and `Private` visibility
- `Open`, `Approval Required`, and `Invite Only` join policies
- RSVP, approval, invitation, capacity, and waitlist flows
- Personal event calendar and basic notifications
- Real-time attendee and capacity updates
- Monthly event creation quota for the free plan

## Architecture goals

Gatherly is planned as a modular monolith with synchronous API decisions and asynchronous side effects:

```text
Next.js client
    |
    v
NestJS API ----> PostgreSQL
    |
    v
RabbitMQ ----> notification and realtime consumers
    |
    v
Socket.IO ----> connected clients
```

The RSVP decision remains in a PostgreSQL transaction. RabbitMQ handles side effects after a successful commit, while Socket.IO communicates persisted capacity changes to connected clients.

## Planned stack

| Area | Technology |
| --- | --- |
| Frontend | Next.js + TypeScript |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL |
| Messaging | RabbitMQ |
| Realtime | Socket.IO |
| Authentication | JWT |
| Local infrastructure | Docker Compose |
| API documentation | Swagger / OpenAPI |
| CI | GitHub Actions |

## Engineering rules

The repository includes a project-specific skill at [`skills/gatherly-best-practices`](./skills/gatherly-best-practices). It captures the invariants that matter most to this project:

- Confirmed attendance is the only state that consumes capacity.
- RSVP, approval, cancellation, and waitlist promotion are transactional.
- Visibility and join policy are different access-control concerns.
- RabbitMQ events are published only after database commit.
- Socket.IO communicates persisted state; it does not decide RSVP outcomes.
- Final-seat contention and duplicate RSVP requests require integration coverage.

## Local development

The application and Docker Compose stack will be added in the next implementation phase. The target local services are:

```text
web       http://localhost:3000
api       http://localhost:3001
swagger   http://localhost:3001/docs
rabbitmq  http://localhost:15672
postgres  localhost:5432
```

## Non-goals for the first release

- Payments and subscription billing
- Native mobile applications
- Live chat and social following
- Advanced recommendations
- Complex map-based discovery
- Microservice decomposition

## License

License selection is pending.
