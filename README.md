# Gatherly

Gatherly is a community-driven event platform for discovering, creating, and joining local events. It is being built as a production-minded learning project around transactional RSVP flows, role-aware access control, asynchronous messaging, and real-time capacity updates.

> **Project status:** Core API modules and the web application are implemented locally; current work focuses on product flows, integration coverage, and UI refinement.

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
- Per-User monthly Event creation quota, stored as a monthly snapshot (default: eight Events)

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

## Documentation

The design documents are part of the project, not generated scaffolding. They record the invariants and module contracts that implementation must preserve.

Start with the [documentation index](./docs/README.md), then read the [system design](./docs/architecture/system.md) and [data model](./docs/architecture/data-model.md).

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

## Local development

The application runs locally through Docker Compose. Available local services are:

```text
web       http://localhost:3000
api       http://localhost:3001
swagger   http://localhost:3001/docs
rabbitmq  http://localhost:15672
mailpit   http://localhost:8025
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
