---
title: Keep event workflows inside feature boundaries
impact: HIGH
tags: architecture, events, rsvp
---

Controllers translate HTTP input and return responses. Services own event and attendance decisions. RabbitMQ and Socket.IO adapters receive domain events after the decision is committed; they do not contain RSVP policy or capacity calculations.

Do not let a controller directly update event counters, publish a broker message, and emit a socket payload. Keep each concern testable and make the transaction owner explicit.
