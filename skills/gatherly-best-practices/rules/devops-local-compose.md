---
title: Keep the local stack reproducible with Docker Compose
impact: MEDIUM
tags: docker, compose, local-development
---

The local environment must run Next.js, NestJS, PostgreSQL, and RabbitMQ from documented environment variables. Keep PostgreSQL and RabbitMQ management ports local-only. Provide health checks for infrastructure services and never commit secrets or local data volumes.

Local deployment may be the product demo environment; document a single start command and the URLs for web, API documentation, and RabbitMQ management.
