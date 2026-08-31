# Gatherly documentation

This directory records the product and engineering decisions that make the application reviewable without a deployed demo. The top-level [README](../README.md) covers the product, screenshots, and the shortest local startup path.

## Start here

- [Local development](./local-development.md): Docker Compose setup, configuration, provider keys, database migrations, and common commands.
- [System design](./architecture/system.md): runtime context, consistency model, critical flows, and evolution path.
- [Application architecture](./architecture/application.md): module interfaces, seams, transaction ownership, and testing shape.
- [Data model](./architecture/data-model.md): persisted tuples, constraints, indexes, and state ownership.
- [Domain glossary](./domain-glossary.md): canonical domain language.

## Module designs

- [Auth](./modules/auth.md)
- [Users and Profile](./modules/users.md)
- [Events](./modules/events.md)
- [Attendance](./modules/attendance.md)
- [Event discovery](./modules/event-discovery.md)
- [Media](./modules/media.md)
- [Notifications, messaging, and realtime](./modules/notifications.md)

## Reading the documentation

The architecture and module documents describe the intended invariants and boundaries. Where product work has evolved beyond an older design note—such as map/route views, history, or organizer handover—the running implementation and API contract are the current source of behaviour. The interactive reference is available locally at http://localhost:3001/reference after startup.
