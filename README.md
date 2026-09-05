# SentinelOps

A real-time incident and operations management platform. SentinelOps is intended to give
engineering and operations teams a single place to detect, triage, and resolve production
incidents — routing alerts to the right responders, tracking incident timelines as they
unfold, and turning the result into reviewable operational records.

---

## Project status

> **Pre-development.** This repository currently contains only its foundation: workspace
> configuration, tooling defaults, and licensing. No application code exists yet.

Nothing described as **planned** below has been implemented. Each piece will be introduced
deliberately in a later stage, and this README will be updated as capabilities actually
land.

**What exists today**

- pnpm workspace configuration
- Root package manifest with pinned Node and pnpm versions
- Git hygiene: `.gitignore`, `.gitattributes`, `.nvmrc`
- Environment variable template (`.env.example`)
- MIT license
- Empty, reserved directories for the structure described below

---

## Planned technology stack

| Layer | Planned choice |
| --- | --- |
| Frontend | Next.js (React) |
| Backend | NestJS |
| Database | PostgreSQL |
| ORM / data access | Prisma |
| Cache, queues, pub-sub | Redis |
| Real-time transport | WebSockets |
| Monorepo tooling | pnpm workspaces |
| Containerization | Docker |
| Language | TypeScript throughout |

Versions are not pinned yet beyond the Node and pnpm floors in `package.json`.

---

## Planned architecture

A monorepo containing two deployable applications, with shared internal packages
introduced when there is a genuine need for code or contracts to be shared.

```
                  Browser
                     │
                     ▼
        ┌──────────────────────────┐
        │   apps/web  (Next.js)    │
        └──────────────────────────┘
                     │
             HTTP / WebSocket
                     │
                     ▼
        ┌──────────────────────────┐
        │   apps/api  (NestJS)     │
        └──────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
   ┌─────────────┐       ┌─────────────┐
   │ PostgreSQL  │       │    Redis    │
   │  (durable)  │       │ cache/queues│
   │             │       │   pub-sub   │
   └─────────────┘       └─────────────┘
```

The web application is planned to talk to the API over HTTP for standard requests and over
WebSocket for live incident updates. `packages/` exists as an optional shared workspace
area — it is not part of the request path, and nothing is required to live there.

---

## Planned capabilities

None of the following are built yet. This is the intended scope, not a feature list.

- **Multi-organization architecture** — tenant isolation across organizations
- **Authentication and authorization** — user identity and session handling
- **Role-based access control** — roles and granular permissions
- **Team management** — teams and membership
- **Service catalog** — the systems being monitored and who owns them
- **Incident lifecycle management** — open, acknowledge, escalate, resolve
- **Severity and priority management** — classification of incident impact
- **Responder assignment** — assigning and reassigning incident responders
- **Comments and incident timeline** — an ordered record of what happened
- **Real-time incident updates** — live state pushed to connected clients
- **Notifications and background jobs** — asynchronous delivery and processing
- **Audit logging** — traceable record of system and user actions
- **Operational dashboards** — aggregate views of incidents and services
- **Observability and health monitoring** — metrics, health checks, diagnostics
- **Testing and security hardening** — automated test coverage and hardening work

---

## Repository structure

All directories below are currently **empty placeholders** held by `.gitkeep` files.

```
sentinelops/
├── apps/              # Deployable applications (planned: web, api)
├── packages/          # Shared internal packages, introduced when genuinely needed
├── docker/            # Container definitions and local dev compose files
├── infrastructure/    # Infrastructure-as-code and deployment configuration
├── docs/              # Project documentation
├── .github/           # CI workflows and repository automation
├── .env.example       # Environment variable template
├── package.json       # Workspace root manifest
└── pnpm-workspace.yaml
```

Only `apps/*` and `packages/*` are registered as pnpm workspaces. The other directories
are plain folders, not packages. No packages exist under `packages/` yet.

---

## Development prerequisites

| Tool | Version |
| --- | --- |
| Node.js | >= 20.11.0 (repo targets 22 — see `.nvmrc`) |
| pnpm | >= 11 (pinned to 11.25.0 via `packageManager`) |
| Git | Any recent version |

Later stages will additionally require Docker, PostgreSQL, and Redis. They are **not**
needed yet.

Enabling pnpm through Corepack will match the pinned version automatically:

```bash
corepack enable
```

If you use `nvm`, `nvm use` will pick up the version in `.nvmrc`.

---

## Setup

> **Intended future workflow.** None of the `pnpm dev`, `build`, `lint`, or `test`
> commands below exist yet — the root `scripts` block is intentionally empty until there
> is something to orchestrate. Only `git clone`, `pnpm install`, and copying the
> environment file do anything today, and `pnpm install` currently resolves no packages
> because the workspace is empty.

```bash
# Clone the repository
git clone <repository-url>
cd sentinelops

# Install dependencies (resolves nothing yet — no packages defined)
pnpm install

# Create your local environment file from the template
cp .env.example .env

# Planned, once applications are added:
pnpm dev      # run web and api in development
pnpm build    # build all workspace packages
pnpm lint     # lint the workspace
pnpm test     # run the test suites
```

### Environment variables

Copy `.env.example` to `.env` and replace the placeholders. `.env` files are ignored by
Git — real secrets must never be committed. When adding a new variable, add a placeholder
to `.env.example` so other developers know it is required.

---

## Documentation

Project documentation lives in [`docs/`](docs/). It is currently empty; architecture
decisions, API references, and operational runbooks will be added there as the project
develops.

---

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 jui-dev.
