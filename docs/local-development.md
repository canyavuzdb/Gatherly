# Local development

Gatherly is currently reviewed and run locally. Docker Compose is the supported complete environment because it provides the application, database, broker, and local mail inbox together.

## Prerequisites

- Docker Desktop or Docker Engine with the Compose plugin
- Node.js 24+
- pnpm 11 (the root `package.json` pins the expected version)

## First startup

From the repository root:

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up --build -d
pnpm migration:run
```

Check that the API is ready before using the web app:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/health/ready
```

Then visit:

| Service | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API reference | http://localhost:3001/reference |
| Mailpit | http://localhost:8025 |
| RabbitMQ management | http://localhost:15672 |

## Configuration

Copying [`.env.example`](../.env.example) produces a safe local baseline. Do not commit `.env` files or provider keys.

| Variable | Required locally | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection used by the API and migration container |
| `RABBITMQ_URL` | Yes | RabbitMQ connection for post-commit messages |
| `JWT_SECRET` | Yes | Replace before any non-local deployment |
| `WEB_ORIGIN` | Yes | Browser origin permitted by API CORS |
| `NEXT_PUBLIC_API_URL` | Yes | API base URL used by the web build |
| `SMTP_*` | Yes | Mailpit defaults are provided for local email flows |
| `MAPTILER_API_KEY` | Optional | Enables provider-backed location search |
| `OPENROUTESERVICE_API_KEY` | Optional | Enables route geometry, distance, and duration |

Without routing credentials, a route event still preserves its start/end points; the detail UI explains that a route could not be generated. Credentials belong in the local `.env` only.

## Daily commands

```bash
pnpm compose:up       # foreground Docker Compose startup with builds
pnpm compose:down     # stop the local stack
pnpm migration:run    # apply pending TypeORM migrations
pnpm dev              # run web + API development servers in parallel
pnpm dev:web          # run only Next.js
pnpm dev:api          # run only NestJS
pnpm build            # production builds for both apps
pnpm lint             # lint both apps
pnpm test             # API Jest suite
```

`pnpm dev` is best used after infrastructure is already available. When API runs on the host rather than in Docker, set `DATABASE_URL` and `RABBITMQ_URL` to host-reachable endpoints; the Docker defaults use Compose service names (`postgres` and `rabbitmq`).

## Database migrations

Migrations are committed in `apps/api/src/database/migrations`. Apply them with:

```bash
pnpm migration:run
```

This command runs the isolated Compose `migrate` service against the local PostgreSQL container. It is safe to repeat: TypeORM records executed migrations. Avoid `migration:revert` unless you are deliberately rolling back a local schema and understand the corresponding data loss.

## Resetting local data

The normal stop command preserves PostgreSQL and media volumes. To start fresh, remove only the Gatherly Compose volumes after stopping the stack:

```bash
pnpm compose:down
docker volume ls --format '{{.Name}}' | rg 'gatherly_(postgres_data|media_data)'
```

Inspect the exact names first, then remove the selected local volumes through Docker Desktop or `docker volume rm`. This is destructive and is not needed for ordinary development.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Web loads but API requests fail | `docker compose ps`, then `docker compose logs api` |
| API starts but tables are missing | Run `pnpm migration:run` |
| Email flow has no inbox message | Open Mailpit at http://localhost:8025 and inspect `SMTP_*` values |
| Location search has no results | Add a valid `MAPTILER_API_KEY` to `.env`, restart the API |
| Route only shows endpoints | Add a valid `OPENROUTESERVICE_API_KEY`, then reload the event detail |
| Port is occupied | Stop the conflicting local process or change the corresponding Compose port mapping |
