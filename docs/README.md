# Gatherly documentation

This documentation records the decisions that shape Gatherly before implementation expands. Read the system design first, then follow the linked architecture and module documents for a specific concern.

## Architecture

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
