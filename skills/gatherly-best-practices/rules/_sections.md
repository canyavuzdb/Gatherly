# Gatherly rule sections

## 1. Attendance consistency (`db`)
Capacity and attendance are authoritative PostgreSQL state. Concurrent mutations must be safe.

## 2. Access control (`security`, `api`)
Visibility controls discovery; ownership and invitations control access and mutation.

## 3. Messaging and realtime (`messaging`, `realtime`)
RabbitMQ carries durable side effects. Socket.IO informs connected clients after state is persisted.

## 4. Architecture (`arch`)
Feature modules own their domain behavior without leaking transport concerns into controllers.

## 5. Tests and local operations (`test`, `devops`)
High-risk workflows need concurrency coverage and must run through Docker Compose locally.
