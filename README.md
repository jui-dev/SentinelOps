# SentinelOps

A real-time incident and operations management platform. SentinelOps is intended to give
engineering and operations teams a single place to detect, triage, and resolve production
incidents — routing alerts to the right responders, tracking incident timelines as they
unfold, and turning the result into reviewable operational records.

---

## Project status

> **Early development.** The backend's foundations are in place and tested, and the web
> app can sign a user in, work within an organization, invite others into it, group its
> members into teams, catalog the services those teams own, and declare, work, and
> resolve incidents against those services. Incidents are recorded by hand; nothing
> detects them yet, and there is no incident timeline yet.

Anything still described as **planned** below has not been built. Each piece is introduced
deliberately, and this README is updated as capabilities actually land.

**What exists today**

- A NestJS API on Express 5, with typed configuration, a single error contract, request
  validation, structured logging, and request correlation
- PostgreSQL via Prisma 7, with the core domain schema and its migrations
- Authentication: registration, login, refresh with rotation, logout, and a global guard
- Tenancy: per-request organization admission, and organization and membership routes
  that enforce tenant isolation
- Authorization: per-route permissions within an organization, mapped from the member's
  role, proven by a rename route that members may not use
- Invitations: an `OWNER` or `ADMIN` invites an email address as `ADMIN` or `MEMBER`
  and shares a single-use link; the invitee creates an account or signs in, and joins.
  See [Invitations](#invitations)
- Teams: an `OWNER` or `ADMIN` creates teams and places existing organization members on
  them. The database itself refuses a team member from another organization. See
  [Teams](#teams)
- Services: an `OWNER` or `ADMIN` records the systems the organization runs, each owned
  by one of its teams and classified by criticality, and retires them by archiving. The
  database itself refuses an owner from another organization, and refuses deleting a
  team that still owns services. See [Services](#services)
- Incidents: any member declares an incident against a service, and the service's owner
  team becomes responsible. Responders set its severity and move its status until it is
  resolved. The database itself keeps every incident's service and team in its own
  organization and refuses deleting either while an incident names it. See
  [Incidents](#incidents)
- A Next.js web app: registration, login, session restore across reloads and tabs,
  an organization picker, per-organization overview, member list, invitations, teams,
  services, incidents, and rename — each offered only when the API reports the
  permission — and an invitation acceptance page. See [Web application](#web-application)
- The web app's UI and design-system foundation: a full-viewport operations workspace
  (situation strip and navigation rail), light and dark themes from semantic design
  tokens, IBM Plex typography, and accessible primitives — with contrast and axe-core
  checks in its tests. It styles only the screens that exist; operational screens are
  designed with their domain models. See [`apps/web/README.md`](apps/web/README.md#ui-foundation)
- Unit, end-to-end, and integration test suites for the API, and unit tests for the web app

**What does not exist yet**

- What builds on incidents: the incident timeline (updates, status and severity
  history, reopening), responders, an operational overview, and service health.
  Detection — monitoring, alerts, paging — and notifications. And no way to remove or
  re-role a member
- Email delivery: invitation links are shared by hand, and addresses are not verified
- Rate limiting on authentication and on the public invitation routes
- Continuous integration, and container images for the applications

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

The intended scope, not a feature list. Only the items marked below are built.

- **Multi-organization architecture** — ✅ tenant admission and resource isolation for
  organization-scoped routes. See [Tenancy](#tenancy)
- **Authentication** — ✅ registration, login, refresh with rotation, logout, and a global
  guard. See [Authentication](#authentication)
- **Authorization and role-based access control** — ✅ per-route permissions mapped from
  the organization role, and invitations. Changing or removing a membership, and
  ownership rules, are still to come. See [Authorization](#authorization) and
  [Invitations](#invitations)
- **Team management** — ✅ teams and who is on them, with tenant consistency enforced by
  the database. See [Teams](#teams)
- **Service catalog** — ✅ the systems an organization runs, which team owns each, and
  how critical each is, with ownership kept within the tenant by the database. Health,
  dependencies, and monitoring are still to come. See [Services](#services)
- **Incident lifecycle management** — ✅ declare, investigate, identify, monitor, and
  resolve, with a responsible team. Reopening and history are still to come. See
  [Incidents](#incidents)
- **Severity management** — ✅ SEV1–SEV4, chosen per incident. See [Incidents](#incidents)
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

```
sentinelops/
├── apps/
│   ├── api/           # NestJS backend
│   └── web/           # Next.js frontend
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
are plain folders, not packages. No packages exist under `packages/` yet, and
`infrastructure/`, `docs/`, and `.github/` are still empty.

---

## Development prerequisites

| Tool | Version |
| --- | --- |
| Node.js | >= 20.11.0 (repo targets 22 — see `.nvmrc`) |
| pnpm | >= 11 (pinned to 11.25.0 via `packageManager`) |
| Git | Any recent version |
| Docker | Any recent version, with Compose v2 (runs PostgreSQL locally) |

Docker is now required — PostgreSQL runs in a local container, so nothing needs to be
installed on the host. See [Database](#database). Redis is **not** needed yet.

Enabling pnpm through Corepack will match the pinned version automatically:

```bash
corepack enable
```

If you use `nvm`, `nvm use` will pick up the version in `.nvmrc`.

---

## Setup

> The root `scripts` block still holds only the database commands. There is no workspace-wide
> `dev`, `build`, `lint`, or `test` orchestration yet — each application is driven through
> `pnpm --filter` until there is enough to orchestrate.

```bash
# Clone the repository
git clone <repository-url>
cd sentinelops
pnpm install

# Create your local environment file from the template, then set JWT_SECRET
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Start PostgreSQL and apply migrations
pnpm db:up
pnpm --filter @sentinelops/api prisma:migrate

# Run the API
pnpm --filter @sentinelops/api start:dev

# Run the web app (Next.js reads its env from apps/web, not from the root)
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @sentinelops/web dev               # http://localhost:3000

# Checks
pnpm --filter @sentinelops/api typecheck
pnpm --filter @sentinelops/api typecheck:test    # includes specs and test helpers
pnpm --filter @sentinelops/api lint
pnpm --filter @sentinelops/api test              # unit, no database
pnpm --filter @sentinelops/api test:e2e          # no database
pnpm --filter @sentinelops/api test:integration  # needs pnpm db:up
pnpm --filter @sentinelops/web lint
pnpm --filter @sentinelops/web typecheck
pnpm --filter @sentinelops/web test              # no API or database
pnpm --filter @sentinelops/web build
```

The API refuses to boot without a `JWT_SECRET` of at least 32 characters. That is
deliberate: a defaulted signing key is a key every deployment that forgot to set one
shares.

### Environment variables

Copy `.env.example` to `.env` and replace the placeholders. `.env` files are ignored by
Git — real secrets must never be committed. When adding a new variable, add a placeholder
to `.env.example` so other developers know it is required.

---

## Configuration

The API validates its environment once at startup and exposes it as structured
configuration domains. Application code consumes those domains rather than environment
variable names, so a variable is spelled out in exactly one place.

### Validated variables

The schema is [`apps/api/src/config/env.validation.ts`](apps/api/src/config/env.validation.ts).

| Variable | Rules | Default |
| --- | --- | --- |
| `NODE_ENV` | One of `development`, `test`, `production` | `development` |
| `PORT` | Integer, 1–65535 | `3001` |
| `DATABASE_URL` | Required. A `postgres://` or `postgresql://` URL | — |
| `LOG_LEVEL` | One of `verbose`, `debug`, `log`, `warn`, `error`, `fatal` | Derived from `NODE_ENV` |
| `LOG_FORMAT` | One of `json`, `pretty` | Derived from `NODE_ENV` |
| `JWT_SECRET` | Required. At least 32 characters | — |
| `JWT_ISSUER` | Non-empty. Stamped as `iss` and required to match on verification | `sentinelops` |
| `JWT_ACCESS_TTL_SECONDS` | Positive integer | `900` |
| `REFRESH_TOKEN_TTL_DAYS` | Positive integer | `30` |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to send credentials | `http://localhost:3000` |

**Validation is fail-fast.** An invalid or missing value aborts startup before the HTTP
server binds, naming every offending variable at once:

```text
Error: Config validation error: PORT: Invalid input: expected number, received NaN
```

Because `DATABASE_URL` and `JWT_SECRET` are required, **`cp .env.example .env` is a
prerequisite** for `start`, `start:dev`, and `test:e2e` — not just for Prisma. Unit tests
(`pnpm test`) do not need it.

The token lifetimes are seconds and whole days rather than `"15m"` strings, so they are
validated as numbers here — like `PORT` — instead of being parsed at the point of use.

### Configuration domains

Domains are declared in [`apps/api/src/config/configuration.ts`](apps/api/src/config/configuration.ts).

| Domain | Value | Type |
| --- | --- | --- |
| `app.port` | Port the API listens on | `number` |
| `app.environment` | Active environment | `'development' \| 'test' \| 'production'` |
| `database.url` | PostgreSQL connection string | `string` |
| `logging.level` | Minimum level to emit | `LogLevel` |
| `logging.format` | Output format | `'json' \| 'pretty'` |
| `app.corsOrigins` | Origins allowed to send credentialed requests | `string[]` |
| `auth.jwtSecret` | Access token signing key | `string` |
| `auth.jwtIssuer` | The `iss` claim, signed and verified | `string` |
| `auth.accessTtlSeconds` | Access token lifetime | `number` |
| `auth.refreshTtlDays` | Refresh token lifetime | `number` |
| `auth.cookieSecure` | Whether the refresh cookie is `Secure` | `boolean` |
| `auth.cookiePath` | Path the refresh cookie is scoped to | `string` |

`auth.cookieSecure` is **derived** from `NODE_ENV` rather than configured, on the same
reasoning as the logging defaults: a flag that must be false on localhost and true
everywhere else is a consequence, not a knob, and exposing it invites a production
deployment that switches it off to make something work.

Prefer injecting a domain by token — the values are typed, so there is no name to mistype
and no cast to get wrong:

```ts
constructor(
  @Inject(databaseConfig.KEY)
  dbConfig: ConfigType<typeof databaseConfig>,
) {
  // dbConfig.url is a string, inferred from the schema
}
```

`ConfigService.get('app.port')` also works and is available for ad-hoc reads, but the dot
path is unchecked and its return type is asserted rather than inferred. Prefer the token.

Only `app`, `database`, and `logging` exist. A domain is added when the infrastructure
behind it does.

`LOG_LEVEL` and `LOG_FORMAT` are the only variables that are **optional in the schema but
defaulted in their factory**: the sensible default depends on `NODE_ENV`, and a Zod
`.default()` cannot read a sibling field. Keeping the derivation in the `logging` factory
puts it in one place rather than splitting it between a schema default and a fallback.

### Application vs. container configuration

`PORT`, `NODE_ENV`, and `DATABASE_URL` are the **application's** configuration and are the
only variables it validates. `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and
`POSTGRES_PORT` are **Docker Compose's** configuration for the local container —
`DATABASE_URL` already carries the host, port, credentials, and database name, so the API
does not read them. Keep the two in sync in `.env`; the API will not check that for you.

`REDIS_URL` and `JWT_SECRET` are placeholders for systems that do not exist yet. They are
deliberately not validated — requiring them would fail the boot over unused
infrastructure.

---

## Database

PostgreSQL runs in a local Docker container; nothing is installed on the host.

```bash
pnpm db:up      # start PostgreSQL in the background
pnpm db:logs    # follow the PostgreSQL logs
pnpm db:down    # stop and remove the container (data is kept)
```

The container is defined in [`docker/docker-compose.yml`](docker/docker-compose.yml) and
reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT` from the
workspace-root `.env`. Data lives in the named volume `sentinelops-postgres-data` and
survives `pnpm db:down`. To discard it deliberately:

```bash
docker volume rm sentinelops-postgres-data
```

### Prisma

The schema is [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma). CLI
behaviour — including loading the root `.env`, which Prisma 7 no longer does
automatically — is configured in [`apps/api/prisma.config.ts`](apps/api/prisma.config.ts).

Prisma Client is generated into `apps/api/src/generated/prisma`, which is **ignored by
Git**. Generate it after cloning and whenever the schema changes:

```bash
cp .env.example .env                              # DATABASE_URL must be set first
pnpm --filter @sentinelops/api prisma:generate
```

`pnpm --filter @sentinelops/api build` runs the generator itself, so a build never uses a
stale client.

### Migration workflow

```text
edit apps/api/prisma/schema.prisma
        |
        v
pnpm --filter @sentinelops/api prisma:migrate --name <migration-name>
        |    creates the migration, applies it, regenerates the client
        v
pnpm --filter @sentinelops/api prisma:status
```

| Script | Command | Purpose |
| --- | --- | --- |
| `prisma:migrate` | `prisma migrate dev` | Create and apply a migration in development |
| `prisma:status` | `prisma migrate status` | Show which migrations are applied |
| `prisma:generate` | `prisma generate` | Regenerate Prisma Client |
| `prisma:studio` | `prisma studio` | Browse the database |

The migration history begins at `init_core_domain`, which creates the core domain
described below. There is deliberately no placeholder migration before it.

### Health endpoints

| Endpoint | Meaning |
| --- | --- |
| `GET /api/v1/health` | Liveness — is the process running? Never touches the database. |
| `GET /api/v1/health/ready` | Readiness — process **and** database. `503` when PostgreSQL is unreachable. |

Both return their body unwrapped: `{"status":"ok"}` and
`{"status":"ok","database":"up"}`. The `503` carries the standard [API error
response](#api-error-responses) like every other error — the readiness signal is
the status code, which is what a probe reads.

---

## Data model

The core domain is three tables: an organization to own data, a user to act, and a
membership binding them with a role. Teams, services, incidents, and audit entries all
hang off these. `invitations` holds offers of a membership, `teams` and
`team_memberships` group members (see [Teams](#teams)), `services` records what those
teams own (see [Services](#services)), `incidents` records the operational problems
declared against those services (see [Incidents](#incidents)), and `refresh_tokens`
holds sessions rather than domain data.

```
┌────────────────────┐                          ┌────────────────────┐
│   organizations    │                          │       users        │
│────────────────────│                          │────────────────────│
│ id      uuid  PK   │                          │ id      uuid  PK   │
│ name    text       │                          │ email   text  UQ   │
│ slug    text  UQ   │                          │ name    text       │
│ created_at         │                          │ password_hash NULL │
│ updated_at         │                          │ created_at         │
│ deleted_at  NULL   │                          │ updated_at         │
│                    │                          │ deleted_at  NULL   │
└─────────┬──────────┘                          └─────────┬──────────┘
          │ 1                                             │ 1
          │        ┌──────────────────────────┐           │
          └───────<│       memberships        │>──────────┤
             N     │──────────────────────────│      N    │
                   │ id               uuid PK │           │
                   │ organization_id  uuid FK │           │
                   │ user_id          uuid FK │           │
                   │ role             role    │           │
                   │ created_at / updated_at  │           │
                   │ UQ(organization_id,      │           │
                   │    user_id)              │           │
                   └──────────────────────────┘           │
                                                          │ 1
                   ┌──────────────────────────┐           │
                   │      refresh_tokens      │>──────────┘
                   │──────────────────────────│      N
                   │ id               uuid PK │
                   │ user_id          uuid FK │
                   │ token_hash       text UQ │
                   │ family_id        uuid    │
                   │ expires_at               │
                   │ revoked_at        NULL   │
                   │ created_at               │
                   └──────────────────────────┘

   organizations 1 ──< invitations >── 1 users (invited_by_id)
                   ┌──────────────────────────────────────┐
                   │             invitations              │
                   │──────────────────────────────────────│
                   │ id                uuid PK            │
                   │ organization_id   uuid FK  (cascade) │
                   │ email             text               │
                   │ role              role               │
                   │ token_hash        text UQ            │
                   │ invited_by_id     uuid FK  (restrict)│
                   │ expires_at                           │
                   │ accepted_at       NULL               │
                   │ revoked_at        NULL               │
                   │ created_at / updated_at              │
                   │ UQ(organization_id, email)           │
                   │   WHERE accepted_at IS NULL          │
                   │     AND revoked_at IS NULL           │
                   └──────────────────────────────────────┘

   organizations 1 ──< teams 1 ──< team_memberships >── 1 memberships
   ┌──────────────────────────────┐   ┌──────────────────────────────────────────┐
   │            teams             │   │             team_memberships             │
   │──────────────────────────────│   │──────────────────────────────────────────│
   │ id              uuid PK      │   │ id               uuid PK                 │
   │ organization_id uuid FK      │   │ organization_id  uuid                    │
   │ name            text         │   │ team_id          uuid                    │
   │ slug            text         │   │ membership_id    uuid                    │
   │ description     text NULL    │   │ created_at                               │
   │ created_at / updated_at      │   │ FK(organization_id, team_id)             │
   │ UQ(organization_id, slug)    │   │   → teams(organization_id, id)           │
   │ UQ(organization_id, name)    │   │ FK(organization_id, membership_id)       │
   │ UQ(organization_id, id)      │   │   → memberships(organization_id, id)     │
   └──────────────────────────────┘   │ UQ(team_id, membership_id)               │
                                      └──────────────────────────────────────────┘
   memberships also carries UQ(organization_id, id), the target of the second key.

   organizations 1 ──< services >── 1 teams (owner_team_id)
                   ┌──────────────────────────────────────────┐
                   │                 services                 │
                   │──────────────────────────────────────────│
                   │ id               uuid PK                 │
                   │ organization_id  uuid FK  (cascade)      │
                   │ name             text                    │
                   │ slug             text                    │
                   │ description      text NULL               │
                   │ owner_team_id    uuid     NOT NULL       │
                   │ criticality      service_criticality     │
                   │                  DEFAULT 'NORMAL'        │
                   │ archived_at      NULL                    │
                   │ created_at / updated_at                  │
                   │ FK(organization_id, owner_team_id)       │
                   │   → teams(organization_id, id)           │
                   │   ON DELETE RESTRICT ON UPDATE RESTRICT  │
                   │ UQ(organization_id, slug)                │
                   │ UQ(organization_id, name)                │
                   │ UQ(organization_id, id)                  │
                   │ IX(organization_id, owner_team_id)       │
                   └──────────────────────────────────────────┘

   organizations 1 ──< incidents >── 1 services, 1 teams, 1 users (created_by_id)
                   ┌──────────────────────────────────────────┐
                   │                incidents                 │
                   │──────────────────────────────────────────│
                   │ id               uuid PK                 │
                   │ organization_id  uuid FK  (cascade)      │
                   │ number           int                     │
                   │ title            text                    │
                   │ summary          text NULL               │
                   │ service_id       uuid     NOT NULL       │
                   │ team_id          uuid     NOT NULL       │
                   │ severity         incident_severity       │
                   │ status           incident_status         │
                   │                  DEFAULT 'INVESTIGATING' │
                   │ created_by_id    uuid FK  (restrict)     │
                   │ created_at / updated_at                  │
                   │ resolved_at      NULL                    │
                   │ FK(organization_id, service_id)          │
                   │   → services(organization_id, id)        │
                   │ FK(organization_id, team_id)             │
                   │   → teams(organization_id, id)           │
                   │   both ON DELETE / UPDATE RESTRICT       │
                   │ UQ(organization_id, number)              │
                   │ UQ(organization_id, id)                  │
                   │ CHECK (status = 'RESOLVED')              │
                   │     = (resolved_at IS NOT NULL)          │
                   │ CHECK (number > 0)                       │
                   └──────────────────────────────────────────┘
   organizations also carries last_incident_number, the counter numbers come from.
```

`users.password_hash` is nullable, reserved for identities without a local password —
federated or passwordless sign-in, neither of which exists yet. Every account created
today sets one: invitations never pre-create a user (see
[Invitations](#invitations)). Login treats null exactly as it treats a wrong password.

`refresh_tokens` is a row per *token*, not per session, because rotation makes a session a
chain: every refresh revokes the presented token and inserts its successor. See
[Authentication](#authentication).

### One identity, many organizations

A `User` is **global, not tenant-scoped**: one row per person, one globally unique email,
one login. Belonging to an organization is a `Membership`, and a person may hold a
different role in each. `@@unique([organizationId, userId])` means a user has exactly one
capacity per organization — nobody is both `ADMIN` and `MEMBER`.

An `Invitation` is a **prospective grant**, not an identity. Issuing one never creates a
`User`: a user is global, so one tenant creating an identity for an address would be a
cross-tenant side effect, and would claim that email before its owner ever signed up. The
account is created — with a password — when the invitation is accepted.

`Role` is `OWNER`, `ADMIN`, `MEMBER`. It is the **initial coarse organization-level role
and an authorization extension point**, not a commitment to the eventual authorization
model — a later stage may add dedicated role or permission structures that read it,
supersede it, or migrate it away. Today it is read in exactly one place: the table that
maps each role to its [permissions](#authorization).

### Deletion: two different mechanisms

| Entity | Application lifecycle | Physical `DELETE` |
| --- | --- | --- |
| `Organization` | **Soft** — set `deleted_at` | Cascades to memberships |
| `User` | **Soft** — set `deleted_at` | Cascades to memberships |
| `Membership` | **Hard** — the row is removed | n/a |
| `Invitation` | **Kept** — accepted or revoked, never deleted | Cascades from its organization; **refused** for a user who sent one |
| `Team` | **Hard** — the row is removed, with its placements | Cascades from its organization |
| `TeamMembership` | **Hard** | Cascades from its team and from its membership |
| `Service` | **Archived** — `archived_at` set; **hard** delete only when no incident names it | Cascades from its organization; **refused** for a team that owns it |
| `Incident` | **Kept** — never deleted | Cascades from its organization; **refused** for a service, a team, or a user it names |

The **ordinary** delete of an organization or user writes `deleted_at`. That is an
`UPDATE`, touches no foreign key, and therefore **preserves memberships and every
historical relationship** — which is the point: a departed responder must still resolve as
the author of a past incident.

`ON DELETE CASCADE` is referential integrity for a **physical** row deletion — an erasure
request, a local reset. It is the exceptional path, not the normal one.

Membership is hard-deleted because revoking access must actually revoke it: a soft-deleted
grant that some future authorization check forgets to filter is a security hole, not a
data-loss risk.

**Deleting organizational configuration never silently deletes operational resources or
historical records.** Configuration — a team, and later who owns what — can be removed
only when nothing operational or historical depends on it; dependents are reassigned
first, and the database enforces that with `Restrict`, not `Cascade`. Deleting a team
removes who was on it, and every member stays in the organization; a team that owns
services cannot be deleted at all until they are moved to another team — the services'
owner key is `ON DELETE RESTRICT`, so the refusal is the database's, raw SQL included.

Incidents are history, and nothing they name can be deleted from under them. Their
service and team keys are `ON DELETE RESTRICT`: a service with incidents cannot be
deleted — retiring it is an **archive**, which keeps it resolvable from every incident
that names it and refuses new ones — and a team that has been responsible for an
incident cannot be deleted at all, only renamed. The declarer is a `User`, not a
`Membership`, so removing someone from the organization leaves their incidents intact;
physically deleting a user who declared incidents is refused, as for invitations.

`Restrict` does not get in the way of the physical deletion of an organization: that
cascade reaches the organization's teams, services, and incidents in the same statement,
and Postgres completes it — `schema.integration-spec.ts` proves it against the real
migration, with incidents naming both a service and a team.

Reads filter on `deleted_at IS NULL` unless they deliberately do not. Login, `GET /auth/me`,
refresh, organization admission, and every organization-scoped read all apply it — see
[Tenancy](#tenancy) for what that means for a soft-deleted user or organization.

### Conventions every later table follows

| Convention | Reason |
| --- | --- |
| snake_case tables and columns via `@@map` / `@map` | Raw SQL and `psql` read naturally without quoting every identifier. |
| `@default(uuid(7))` in `@db.Uuid` columns | 16 bytes rather than a 36-character string, and time-ordered, so primary-key inserts stay local in the btree. |
| `@db.Timestamptz(3)` on every timestamp | Prisma maps `DateTime` to `timestamp` **without** time zone by default. |
| Plain `text` for strings | Length limits live in the Zod schemas at the request boundary, where this project already validates. |
| Tenant-owned tables carry `organizationId` | The isolation convention. Every query on one filters by it — see [Tenancy](#tenancy). |
| A tenant-owned row references another tenant-owned row by a composite key on `organization_id` | The database, not only the service, keeps both rows in one organization — see [Tenant consistency by composite foreign key](#tenant-consistency-by-composite-foreign-key). |

Foreign keys are indexed where no other index leads with them: `memberships.user_id`,
`refresh_tokens.user_id`, `invitations.invited_by_id`,
`team_memberships.membership_id`, `services(organization_id, owner_team_id)` — which
serves the `Restrict` check when a team is deleted — and on incidents
`(organization_id, service_id)`, `(organization_id, team_id)`, and `created_by_id`, which
serve the `Restrict` checks on deleting a service, a team, or a user. `memberships.organization_id`
needs no index of its own — it leads the composite unique, which already serves prefix
lookups and the cascade from `organizations`.

### Tenant consistency by composite foreign key

A `team_memberships` row joins a team to a membership, and both must belong to the same
organization. Plain foreign keys on `team_id` and `membership_id` would not say so: the
database would accept a team in one organization joined to a membership in another, and
only service code would stand in the way.

Instead the row carries `organization_id`, and both foreign keys are composite and share
it — `(organization_id, team_id)` references `teams(organization_id, id)`, and
`(organization_id, membership_id)` references `memberships(organization_id, id)`. Both
referenced rows must therefore carry the row's own organization, so a cross-tenant team
member is unrepresentable, whichever organization the row claims and however it is
written — raw SQL included. The `UQ(organization_id, id)` on `teams` and `memberships`
is redundant with their primary keys and exists only because a composite foreign key must
reference a unique constraint over exactly its columns. As a side effect, moving a
membership to another organization while it is on a team is refused: `ON UPDATE CASCADE`
carries the new organization into the placement, which then no longer matches its team.

A service's owning team follows the same pattern with a single key:
`(organization_id, owner_team_id)` references `teams(organization_id, id)`, and
`owner_team_id` is `NOT NULL`, so the key is checked on every row — a service owned by
another organization's team is unrepresentable. That key is `RESTRICT` on update as well
as on delete. `ON UPDATE CASCADE` there would be a hazard rather than a safeguard: with
no second composite key to contradict it, moving a team to another organization would
silently carry its services along. Instead the move is refused while the team owns any.

An incident carries two such keys on its one `organization_id`:
`(organization_id, service_id)` references `services(organization_id, id)` and
`(organization_id, team_id)` references `teams(organization_id, id)`, both `RESTRICT` on
delete and on update. Its affected service and its responsible team must therefore
belong to its own organization — and to each other's — however the row is written.
The declarer is the exception, and the only one: `users` are global, so no composite key
can hold a user to an organization. `IncidentsService` takes the declarer from the
admitted membership, inside the declaring transaction, and never from a request body.

This is declarative, visible to Prisma (no drift), and costs nothing at runtime. The
application still scopes every query by organization — the constraint is the backstop,
not the mechanism that produces the right `404`.

A partial unique index is declared in `schema.prisma` with Prisma's `partialIndexes`
preview feature, so Prisma knows about it and never treats it as drift. Preview features
can change between Prisma releases; re-check this one when upgrading. Prisma still
generates an ordinary unique lookup key for such an index, which would ignore its
predicate — see [Invitations](#invitations).

### Integration tests

Constraints, cascades, and column types are properties of the database, so they are tested
against a real one:

```bash
pnpm db:up
pnpm --filter @sentinelops/api test:integration
```

This suite is **opt-in and separate** — `pnpm test` and `pnpm run test:e2e` need no
database and are unaffected.

It runs against a **dedicated** database named by `TEST_DATABASE_URL` (see
`.env.example`), created and migrated automatically on first run. Because the suite
truncates tables between tests, it refuses to start unless that database's name ends in
`_test` **and** differs from `DATABASE_URL`'s, and it never falls back to `DATABASE_URL`.

---

## API conventions

These apply to every endpoint. They are wired once in
[`apps/api/src/common/common.module.ts`](apps/api/src/common/common.module.ts) as
`APP_PIPE` and `APP_FILTER` providers, so importing `AppModule` — as every
end-to-end test does — brings the real behaviour with it.

### Successful responses are not wrapped

A handler returns the resource itself. There is no `{ data: … }` envelope: the
status code already signals success, and an envelope taxes every client call and
every test to reserve space for metadata only collection endpoints need. When
collections arrive they will declare their own shape explicitly:

```jsonc
{ "items": [ /* … */ ], "page": { "cursor": "…", "hasMore": true } }
```

### API error responses

Every non-2xx response — validation failure, thrown exception, unknown route,
unhandled crash — has one shape, defined in
[`api-error.contract.ts`](apps/api/src/common/api-error.contract.ts) and built
only by `AllExceptionsFilter`:

```jsonc
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Request validation failed",
  "code": "INCIDENT_RESOLVED",         // optional, only when the thrower sets one
  "details": [                         // optional, only for field-level failures
    { "field": "responders.0.email", "message": "Invalid email address" }
  ],
  "requestId": "0f9c1e2a-…",
  "timestamp": "2026-09-07T10:15:00.000Z",
  "path": "/api/v1/incidents"
}
```

| Rule | Why |
| --- | --- |
| `message` is **always** a string | Nest's own bodies alternate between `string` and `string[]`. Field-level information lives in `details`, whose element shape is stable. |
| Unexpected errors return a generic `500` | Anything that is not an `HttpException` is masked as `Internal server error`. The real error and stack are logged, so a driver error never reaches a client. |
| `requestId` is always present | Returned in the body and in the `X-Request-Id` header, and logged with every `5xx` — it is the join key between a client-visible failure and the server-side stack trace. |
| `code` is optional | Set through Nest's `HttpExceptionOptions.errorCode`. Nothing sets one yet; it exists so adding machine-readable codes later is additive. |

A caller may supply `X-Request-Id` and it is echoed back, but only when it is
short and unremarkable — the value reaches a response header and the log, so
anything else is replaced with a generated id.

### Request validation

Validation uses NestJS 12's built-in `StandardSchemaValidationPipe` with Zod 4 —
the same Zod already validating the environment, and **no additional
dependency**. Nest 12 depends on `@standard-schema/spec` directly and accepts a
schema on the parameter decorators, so a Zod schema is usable as-is;
`class-validator` and `class-transformer` are deliberately not installed.

Schema and inferred type live together, next to the module that owns them:

```ts
export const createIncidentSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  serviceId: z.uuid(),
  severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']),
});
export type CreateIncidentRequest = z.infer<typeof createIncidentSchema>;

@Post()
create(@Body({ schema: createIncidentSchema }) body: CreateIncidentRequest) { … }
```

The pipe is global but **opt-in**: a parameter that declares no `schema` is
passed through untouched. `@Query()` and `@Param()` take a schema the same way.
Two behaviours worth knowing, because they replace `ValidationPipe` options:
`z.object()` strips unknown keys by default (use `.strict()` to reject them
instead), and coercion belongs in the schema — `z.coerce.number()` on a query
parameter works exactly as `PORT` does in the environment schema.

Failures produce the contract above with one `details` entry per invalid field,
addressed by a dotted path (`responders.0.email`). Only each issue's message and
path are returned; the submitted value is never echoed back.

---

## Authentication

Every route is authenticated **by default**. `JwtAuthGuard` is registered as a global
`APP_GUARD` in [`apps/api/src/auth/auth.module.ts`](apps/api/src/auth/auth.module.ts), so a
new endpoint is closed unless someone deliberately opens it with `@Public()` — and opening
one is a visible line in a diff.

Nothing here uses Passport. `@nestjs/jwt` signs and verifies; the guard is forty lines.

### Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/register` | public | Create an organization, its owner, and a session |
| `POST /api/v1/auth/register/invitation` | public | Create an account by accepting an invitation, and a session — see [Invitations](#invitations) |
| `POST /api/v1/auth/login` | public | Exchange credentials for a session |
| `POST /api/v1/auth/refresh` | public | Rotate the refresh cookie, mint a new access token |
| `POST /api/v1/auth/logout` | public | End the session, clear the cookie |
| `GET /api/v1/auth/me` | **required** | The caller and their memberships |

Logout is public on purpose: it authenticates off the refresh cookie, so an expired access
token must not be able to strand a session. It is idempotent — an unknown or absent cookie
still returns `204`, revealing nothing.

### Registration creates a tenant

One request creates an `Organization`, a `User`, and a `Membership` with role `OWNER`, in a
single transaction:

```jsonc
POST /api/v1/auth/register
{
  "email": "ada@example.com",
  "password": "a sufficiently long passphrase",
  "name": "Ada Lovelace",
  "organizationName": "Acme Operations",
  "organizationSlug": "acme-ops"   // optional; derived from the name when absent
}
```

The three rows are meaningless apart — a user with no membership can do nothing in a
tenant-scoped product — so either all three exist or none do. `OWNER` is not requestable;
it is a consequence of having created the tenant.

Uniqueness is enforced by the database, not by checking first: a read-then-write check
races, and two registrations for one address can both find it free. The constraint
violation is caught and translated instead.

| Situation | Response |
| --- | --- |
| Email already registered | `409` `EMAIL_ALREADY_REGISTERED` |
| Slug already taken | `409` `ORGANIZATION_SLUG_TAKEN` |
| No slug derivable from the name | `400`, asking for `organizationSlug` |

A taken slug is refused rather than silently suffixed: a caller who typed "Acme" and
received `acme-2` has a URL they did not choose. A soft-deleted user still owns its unique
email, so re-registering that address is a `409`; reclaiming addresses is out of scope.

### Two tokens, two transports

| | Access token | Refresh token |
| --- | --- | --- |
| Form | JWT, HS256 | 32 random bytes, base64url |
| Lifetime | 15 minutes | 30 days |
| Travels in | The JSON response body | An `httpOnly` cookie |
| Stored | Nowhere on the server | As a SHA-256 hash |

The access token carries **identity only** — `sub`, `iss`, `iat`, `exp`. No email, which
would go stale; no organization or role, so that revoking a membership takes effect on the
next request rather than at the next expiry, and switching organizations needs no new
token. The cost is one indexed membership lookup per scoped request, which is the right
trade for an operations tool.

The guard reads **no database**. Verifying a signature is arithmetic; a lookup would add a
query to every authenticated request to catch a user deleted within fifteen minutes. Stated
plainly: a soft-deleted user keeps working until their access token expires. Revocation
bites at refresh, which does check.

The refresh cookie is `HttpOnly`, `SameSite=Lax`, `Secure` outside development, and scoped
to `Path=/api/v1/auth` so it is not attached to ordinary API calls. It is stored only as a
SHA-256 hash — not Argon2, which would be wrong twice over: the token is 256 bits from a
CSPRNG, so there is no low-entropy guess for a slow hash to frustrate, and lookup happens
*by* the hash, which needs to be deterministic.

**CSRF**: `SameSite=Lax` means browsers do not attach the cookie to a cross-site `POST`, and
`/auth/refresh` is `POST`-only. The API accepts no cross-site form submissions, so a CSRF
token would add ceremony without changing the threat model. That reasoning depends on the
cookie policy staying as it is.

### Rotation and reuse detection

Every refresh revokes the presented token and issues its successor in the same **family** —
a shared id linking every token descended from one login.

| Presented token | Response |
| --- | --- |
| Unknown | `401` `INVALID_REFRESH_TOKEN` |
| Expired | `401` `REFRESH_TOKEN_EXPIRED` |
| Already rotated away | **The whole family is revoked**, then `401` `REFRESH_TOKEN_REUSED` |
| Belongs to a soft-deleted user | `401` `INVALID_REFRESH_TOKEN` |
| Valid | `200`, with a new access token and a rotated cookie |

Reuse detection is why a revoked row is kept until it expires rather than deleted on
rotation: deleting it would make a replayed token indistinguishable from an unknown one,
and the theft would go unnoticed. When a stolen token is replayed after the legitimate
client has rotated past it, killing the family stops both parties rather than leaving the
thief working. Other sessions belonging to the same user are untouched.

### Passwords

Argon2id via `@node-rs/argon2`, at OWASP's first recommended configuration: 19 MiB of
memory, two passes, one lane. The package ships prebuilt platform binaries and runs no
install script, so it needs no `allowBuilds` entry and no compiler.

The algorithm, version, parameters, and a per-password salt all travel inside the stored
PHC string, so raising the parameters later invalidates nothing.

Policy is length only — at least 12 characters, at most 128. Composition rules push people
towards `Passw0rd!` and away from the long passphrases that are actually harder to guess,
which is the position NIST SP 800-63B settled on.

Login answers identically for an unknown email, a soft-deleted account, an account with no
password, and a wrong password. When no user is found it still verifies against a dummy
hash, so response timing does not disclose whether an address exists.

### The current user

`JwtAuthGuard` records the verified user id in the same `AsyncLocalStorage` context that
carries the request id, rather than hanging a property on the Express request. Two things
follow:

- `@CurrentUserId()` reads it. Named for exactly what it returns — the token carries
  identity and nothing else, so a `@CurrentUser()` returning a one-field object would
  promise more than it holds. Organization and role are resolved separately, per request,
  and read with `@CurrentMembership()` — see [Tenancy](#tenancy).
- **Every log line emitted after the guard runs carries `userId`**, with no call site
  passing it along. See [Request correlation](#request-correlation).

### Responses never carry persistence internals

No Prisma model is returned from a controller, and no response is built by spreading one.
Three independent layers:

1. **Explicit mappers** in [`auth.responses.ts`](apps/api/src/auth/auth.responses.ts) name
   every field they emit. A spread-then-delete would leak each column a future migration
   adds, and the first time such a column is a secret the leak has already shipped.
2. **Narrow `select` clauses** on every query, so excluded columns are never in memory.
   `passwordHash` is selected in exactly one place — the login lookup — and read into a
   local, never onto a returned object.
3. **A leak assertion** in the integration suite walks every response body, success and
   error alike, and fails on any of `passwordHash`, `tokenHash`, `familyId`, `deletedAt`,
   `revokedAt`, or a value equal to the submitted password or issued token.

The refresh token appears in a `Set-Cookie` header and nowhere else. Soft-delete metadata
is a filter, not a field.

### Error codes

These are the first values to populate the optional `code` on the
[error contract](#api-error-responses), which earlier stages built and left unset. Clients
branch on them, so they are part of the public API.

`EMAIL_ALREADY_REGISTERED` · `ORGANIZATION_SLUG_TAKEN` · `INVALID_CREDENTIALS` ·
`INVALID_REFRESH_TOKEN` · `REFRESH_TOKEN_EXPIRED` · `REFRESH_TOKEN_REUSED` ·
`UNAUTHENTICATED`

[Tenancy](#tenancy) adds `ORGANIZATION_NOT_FOUND` and `MEMBERSHIP_NOT_FOUND`.
[Authorization](#authorization) adds `PERMISSION_DENIED`.
[Invitations](#invitations) adds `INVITATION_NOT_FOUND`, `INVITATION_NOT_PENDING`,
`INVITATION_ALREADY_PENDING`, `INVITATION_EMAIL_MISMATCH`, and `ALREADY_A_MEMBER`.
[Teams](#teams), [Services](#services), and [Incidents](#incidents) add their own,
listed in their sections.

### Known gaps

- **No rate limiting on login, signup by invitation, or invitation lookup.** The honest
  gap, and security-hardening work still to do. Guessing a 256-bit invitation token is not
  a realistic attack, but both account-creating routes make the server hash a password.
  In-memory throttling does little once there is more than one instance; how a shared
  limit is kept is left to the stage that builds it.
- **No email verification or password reset.** Both need mail delivery.
- **Expired refresh tokens are not reaped.** They are rejected on use; deleting them needs
  a scheduler.

---

## Tenancy

A `User` is global; everything else a user does happens *within an organization*. This
section is how a request says which one, and how the API makes sure it stays there.

### Addressing an organization

The organization is named by the route, and only by the route:

```
GET /api/v1/organizations/:organizationId/...
Authorization: Bearer <access token — identity only>
```

The query string, headers, and body are never consulted for it. Adding
`?organizationId=…` or an `X-Organization-Id` header changes nothing, and request schemas for
tenant resources never declare an `organizationId` (or any other tenant-identity) field —
the tenant a write applies to is the one in the path.

The id is used rather than the slug because a slug can be renamed. The web app is free to
put slugs in its own URLs.

### Endpoints

| Route | Purpose | Permission |
| --- | --- | --- |
| `GET /api/v1/organizations/:organizationId` | The organization, and the caller's membership and permissions in it | `organization:read` |
| `PATCH /api/v1/organizations/:organizationId` | Rename the organization: `{ "name": "…" }`, nothing else | `organization:update` |
| `GET /api/v1/organizations/:organizationId/memberships` | Every membership record, oldest first | `memberships:read` |
| `GET /api/v1/organizations/:organizationId/memberships/:membershipId` | One membership record | `memberships:read` |
| `POST /api/v1/organizations/:organizationId/invitations` | Invite an email address: `{ "email", "role" }` | `invitations:manage` |
| `GET /api/v1/organizations/:organizationId/invitations` | Every open invitation, newest first | `invitations:read` |
| `DELETE /api/v1/organizations/:organizationId/invitations/:invitationId` | Revoke an open invitation | `invitations:manage` |
| `/api/v1/organizations/:organizationId/teams…` | Teams and who is on them — see [Teams](#teams) | `teams:read` / `teams:manage` |
| `/api/v1/organizations/:organizationId/services…` | Services and who owns them — see [Services](#services) | `services:read` / `services:manage` |
| `/api/v1/organizations/:organizationId/incidents…` | Incidents — see [Incidents](#incidents) | `incidents:read` / `incidents:manage` |

All require authentication, a current membership, and the listed permission — every role
may read the organization and its memberships; only `OWNER` and `ADMIN` may rename it or
see and manage its invitations (see [Authorization](#authorization) and
[Invitations](#invitations)). The
organization read carries the caller's grant as
`membership: { id, role, permissions }` — see
[Telling a client what it may do](#telling-a-client-what-it-may-do). The
rename returns the organization without the caller's membership, and leaves the slug
alone. The resource is named `memberships`, not `members`,
because each item *is* a membership: its `id` is the membership's id, and it carries the
role and the date the grant was made, with the user nested inside as `{ id, name, email }`.
A member's other organizations are never included.

### Admission is not isolation

Two different checks, and the second is never skipped because the first passed.
[Authorization](#authorization) is a third, and replaces neither:

| | Tenant admission | Authorization | Resource isolation |
| --- | --- | --- | --- |
| Question | Is the caller a current member of `organizationId`? | May this member's role do this? | Does *this row* belong to `organizationId`? |
| Where | `OrganizationMembershipGuard`, once per request | `OrganizationPermissionGuard`, once per request | Every query on tenant-owned data, in the service |
| How | Membership lookup by organization and user | The admitted role against the handler's permission — no query | `where: { id: resourceId, organizationId }` |
| Failure | `404 ORGANIZATION_NOT_FOUND` | `403 PERMISSION_DENIED` | `404` for that resource, e.g. `MEMBERSHIP_NOT_FOUND` |

A caller admitted to organization A can still put an id that belongs to organization B in
the URL. So every lookup of a tenant-owned row:

- puts `organizationId` **in the predicate**, alongside the resource id;
- never fetches by id alone and checks the organization afterwards;
- never relies on the guard as its only tenant filter.

Services take `organizationId` as an explicit argument, supplied by the handler from the
admitted membership. They do not read it from the request context — that context exists
for cross-cutting concerns such as logging, and background work has none. A service is
therefore correct when called with no guard in front of it, and the integration suite calls
it exactly that way to prove it.

Database-level tenant-consistency constraints — composite foreign keys that include
`organization_id` — are weighed relationship by relationship as tables are added, not
applied as a blanket rule. Team members, service owners, and an incident's service and
team all carry one; see
[Tenant consistency by composite foreign key](#tenant-consistency-by-composite-foreign-key).
They are the backstop, never a replacement for the organization filter in the query.

### A request's path through it

1. `RequestIdMiddleware` opens the request context.
2. `JwtAuthGuard` (global) verifies the token and records `userId`. No database.
3. `OrganizationMembershipGuard` (per controller) reads `:organizationId`, looks up the
   caller's membership, and records `{ organizationId, membershipId, role }`.
4. `OrganizationPermissionGuard` (per handler) checks that role against the handler's
   permission. No database.
5. The request body is validated.
6. The handler reads the membership with `@CurrentMembership()` and passes `organizationId`
   to the service.
7. The service scopes every query by it.

Organization-scoped controllers are declared with `@OrganizationController()`, which
attaches the route prefix and the admission guard together. It is the only place in `src/`
allowed to spell the route parameter, and an architecture spec fails the unit suite if one
appears anywhere else — so a tenant route cannot be declared without admission. Because the
guard is attached at controller level rather than as a second `APP_GUARD`, Nest's own rule
that global guards run first guarantees authentication precedes it.

A module that declares such a controller imports `TenancyModule`. A route that is both
`@Public()` and organization-scoped, or that reads `@CurrentMembership()` without being
admitted, fails closed with a masked `500` — a wiring mistake, never an anonymous request
inside a tenant.

### Membership is resolved on every request

One indexed lookup on `(organization_id, user_id)`, filtering soft-deleted organizations
and soft-deleted users, and never cached. That is deliberate:

- **Revocation is immediate.** Removing a membership refuses the very next request, even
  with an access token issued before the removal.
- **A soft-deleted user is refused here** even though `JwtAuthGuard` reads no database and
  their token still verifies.
- **A soft-deleted organization is unreachable** through every route beneath it.

### Why the organization is not in the token

The access token carries identity and nothing else. Putting the organization or role in it
would keep a revoked membership or a changed role working until the token expired, would
tie one token to one organization, and would mean minting a new token to switch.

### Switching organizations

There is nothing to switch on the server. The organization is part of every URL, so moving
to another one is a client-side navigation to different URLs — no request, no new token, and
two browser tabs can work in two organizations at once. `GET /auth/me` already lists the
caller's memberships for an organization picker. Remembering a "last active" organization
is a later, additive concern.

### One answer for everything inaccessible

A malformed organization id, one that does not exist, one that was soft-deleted, one the
caller does not belong to, and a caller whose own account was soft-deleted all produce the
same `404` with code `ORGANIZATION_NOT_FOUND` and the message `Organization not found`.
`403` would confirm that the organization exists. The same holds one level down: a
membership id that is malformed, missing, or belongs to another organization is
`404 MEMBERSHIP_NOT_FOUND`. Neither message echoes the id. Malformed ids are refused before
they reach Postgres, which would otherwise fail the `uuid` cast with a `500`.

### Not yet

- **Membership changes.** Members join through [invitations](#invitations), but there is
  no API to remove or re-role one, and so none of the ownership rules those need — see
  [Authorization](#authorization).
- **Row-level security, or automatic tenant filtering in the Prisma client.** Scoping is
  explicit in every query and proven by tests. Either may be added later as defence in
  depth.

### Tests

[`tenancy.integration-spec.ts`](apps/api/test/tenancy.integration-spec.ts) runs two tenants
and a user who belongs to both against a real database. Among other things, it proves that
a caller admitted to one organization cannot read a membership belonging to the other
through its URL, that a foreign organization is indistinguishable from a nonexistent one,
that spoofed query and header values change nothing, that revocation and soft deletion take
effect on the next request, and that interleaved requests from two tenants stay in their
own.

---

## Authorization

Tenancy decides whether a caller is *in* an organization. Authorization decides what they
may *do* there. It is a third layer: it runs only after admission, and it never replaces
the organization filter in a query.

### Permissions, not roles, on routes

Every organization-scoped handler declares exactly one permission:

```ts
@Patch()
@RequirePermission(Permission.ORGANIZATION_UPDATE)
updateOrganization(...)
```

Which roles hold which permission is written out once, in
[`role-permissions.ts`](apps/api/src/authorization/role-permissions.ts):

| Permission | `OWNER` | `ADMIN` | `MEMBER` |
| --- | --- | --- | --- |
| `organization:read` | ✓ | ✓ | ✓ |
| `organization:update` | ✓ | ✓ | |
| `memberships:read` | ✓ | ✓ | ✓ |
| `invitations:read` | ✓ | ✓ | |
| `invitations:manage` | ✓ | ✓ | |
| `teams:read` | ✓ | ✓ | ✓ |
| `teams:manage` | ✓ | ✓ | |
| `services:read` | ✓ | ✓ | ✓ |
| `services:manage` | ✓ | ✓ | |
| `incidents:read` | ✓ | ✓ | ✓ |
| `incidents:manage` | ✓ | ✓ | ✓ |

A `MEMBER` cannot see open invitations: they name people who are not members yet.
Belonging to a team grants nothing, and neither does a team owning a service or being
responsible for an incident: authorization is the organization role alone.

**Configuration is admin-governed; incident response is member-driven.** Teams,
services, and invitations shape the organization, so only `OWNER` and `ADMIN` change
them. Incidents are operational work: the engineer who notices card payments failing
must be able to declare it and move it to resolution without finding an admin first, so
every role holds `incidents:manage`. It is still a distinct permission, so a narrower
role later — a read-only stakeholder — is a change to the table alone.

There is no `@RequireRole()`. A route that names roles has to be edited every time the
policy changes; a route that names an operation does not. The table is explicit per role
rather than derived from `OWNER > ADMIN > MEMBER` — a spec asserts that ordering holds
today, but a later role that does not fit the ladder is a change to the table alone.
Permissions are added with the routes that need them, so there is no `OWNER`-only entry:
no operation is `OWNER`-only yet.

### Where the role comes from

From the membership that admission already resolved for this request, carried in the
request context. There is no second lookup, the token carries no role, and nothing in the
query string, headers, or body is consulted. Because membership is resolved per request, a
demotion or promotion takes effect on the very next request with the same token.

`OrganizationPermissionGuard` reads the request context; services do not. A service whose
rules depend on who is acting takes the actor as an explicit parameter — the rename does
not, because nothing about renaming depends on it.

### Telling a client what it may do

`GET /organizations/:organizationId` reports the caller's permissions there, sorted:

```jsonc
"membership": {
  "id": "…",
  "role": "MEMBER",
  "permissions": ["memberships:read", "organization:read"]
}
```

They are read from the same table the guard enforces, through `permissionsFor(role)`, so
what a client is told and what the API allows cannot diverge. A client uses the list to
decide what to *offer* — the web app hides the rename form without `organization:update` —
and never to decide what is *allowed*: every route still checks. It is resolved per
request like the role, so a promotion shows up on the next read. The list is not in the
token or in `/auth/me`, which stays about identity and memberships. It tells a member
nothing their own role does not already let them do.

### 403 here, 404 everywhere else

| Situation | Response |
| --- | --- |
| Not authenticated | `401 UNAUTHENTICATED` |
| Organization missing, malformed, soft-deleted, or not yours | `404 ORGANIZATION_NOT_FOUND` |
| A member whose role lacks the permission | `403 PERMISSION_DENIED` |
| A resource id that is not in this organization | `404` for that resource |

`403` is safe only because it is reachable only after admission: it tells a member what
they already know. The message names neither the permission nor the role that would have
sufficed. Guards run before validation, so a member without the permission is refused
before their body is looked at.

### Default deny, and failing closed

`@RequirePermission()` sets the permission and attaches the guard that enforces it,
together, on the method — so it always runs after the controller's admission guard.

| Mistake | Result |
| --- | --- |
| An `@OrganizationController()` handler with no `@RequirePermission()` | Masked `500` before any query — admission refuses it |
| `@RequirePermission()` on a controller that admits no organization | Masked `500` — there is no role to check. An architecture spec also rejects it |

Neither ever lets a request through.

### Write bodies are strict

The rename body is `z.strictObject({ name })`: `slug`, `role`, `organizationId`, or any
other extra key is a `400`, not silently dropped. The update itself is a single statement
on `{ id, deletedAt: null }`, so an organization soft-deleted after admission answers the
same `404` and is never written.

### Not yet

- **Membership management** — removal, leaving, and role changes. Invitations exist, but
  cannot offer `OWNER`, so they need none of the rules below.
- **Ownership rules**, which arrive with it: the last `OWNER` cannot be removed or demoted;
  an `ADMIN` cannot change an `OWNER` or grant `OWNER`; ownership transfer is one
  transaction. These depend on the target row and on other rows, so they are service-level
  checks with an explicit actor, not permissions.
- **Deleting an organization or changing its slug**, custom roles, and anything
  finer-grained than one permission per route.

### Tests

[`authorization.e2e-spec.ts`](apps/api/test/authorization.e2e-spec.ts) proves the ordering,
the `403`/`404` split, and every wiring failure against the real `AppModule`.
[`authorization.integration-spec.ts`](apps/api/test/authorization.integration-spec.ts) runs a
user who is `ADMIN` in one organization and `MEMBER` in another with a single token, and
proves that role changes apply on the next request, that refused writes leave the row
untouched, that the update-miss mapping holds against the real driver adapter, and that
interleaved requests in different roles stay apart.

---

## Invitations

Members join an organization by invitation. An `OWNER` or `ADMIN` invites an email
address as `ADMIN` or `MEMBER`, and receives a link to share however they choose — there is
no email delivery. The invitee opens it and either creates an account or signs in with the
invited address, and joins.

### Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/organizations/:organizationId/invitations` | `invitations:manage` | Invite `{ "email", "role" }`. `201` with `{ invitation, token, replacedExisting }` |
| `GET /api/v1/organizations/:organizationId/invitations` | `invitations:read` | Open invitations, newest first, each `pending` or `expired` |
| `DELETE /api/v1/organizations/:organizationId/invitations/:invitationId` | `invitations:manage` | Revoke an open invitation. `204` |
| `POST /api/v1/invitations/lookup` | public | `{ "token" }` → the organization, email, role, expiry, and inviter's name |
| `POST /api/v1/invitations/accept` | **required** | `{ "token" }` → the new membership, as `/auth/me` lists one |
| `POST /api/v1/auth/register/invitation` | public | `{ "token", "name", "password" }` → an account, its membership, and a session |

`OWNER` is not invitable: ownership is a consequence of creating an organization, and
transferring it belongs with the ownership rules still to come. The organization-scoped
routes follow [Tenancy](#tenancy) and [Authorization](#authorization) exactly — admission
`404`, permission `403`, and `{ id, organizationId }` in every query. The token routes take
the organization from the invitation and from nothing in the request.

### Lifecycle

Rows are kept. Status is derived, never stored: **revoked**, else **accepted**, else
**expired** (past `expires_at`, seven days after creation), else **pending**. An invitation
is **open** while it is neither accepted nor revoked — expired ones included, which stay in
the list until replaced or revoked.

**At most one open invitation per organization and email**, enforced by the database with a
partial unique index on `(organization_id, email) WHERE accepted_at IS NULL AND revoked_at
IS NULL`. Expiry cannot be part of the predicate — an index predicate cannot read the
clock — and does not need to be: an expired offer is still the organization's outstanding
one until someone acts on it.

- **Inviting again replaces.** Creating an invitation revokes any open one for the same
  address in the same transaction, and the response says so with `replacedExisting`. The
  old link stops working.
- **Concurrent creates.** When two creates for the same address genuinely overlap — both
  insert before either commits — the second insert waits on the first's index entry and
  fails when it commits. It is answered `409 INVITATION_ALREADY_PENDING`, with no link,
  rather than retried, which would silently kill the link the other request was just
  shown. A create that runs after another has committed is an ordinary re-invite: it
  replaces the open invitation and succeeds. So a burst of simultaneous requests may see
  more than one `201`; what is guaranteed is that at most one invitation is ever open for
  the address, and once the requests settle only the last surviving link works.
- **Already a member.** Inviting the address of a current member is
  `409 ALREADY_A_MEMBER`. Membership in other organizations is not considered.

Never look an invitation up with Prisma's generated `organizationId_email` unique input: the
index behind it is partial, and that lookup ignores the predicate. An architecture spec
forbids it.

The inviter is recorded as `invited_by_id`, which is **required** and **`ON DELETE
RESTRICT`**. A user's ordinary delete is soft and leaves it intact, and lists keep naming a
soft-deleted inviter — attribution is history, not access. Physically deleting a user who
has sent invitations fails: erasure must be a deliberate procedure that decides what
happens to that history, not a cascade that erases it or a `SET NULL` that quietly loses it.
Physically deleting an organization removes its invitations, as it removes its memberships.

### Accepting

Both ways of accepting run one transaction that **validates everything first, claims the
invitation, and only then grants**:

1. Resolve the invitation from the token. Unknown → `404`.
2. Its organization still exists. Otherwise `404`.
3. It is pending. Otherwise `404`.
4. The account:
   - *signed in:* the caller still exists (`401`), and their email is the invited one
     (`403 INVITATION_EMAIL_MISMATCH`), and they are not already a member
     (`409 ALREADY_A_MEMBER`);
   - *new account:* no account, soft-deleted ones included, holds the address
     (`409 EMAIL_ALREADY_REGISTERED`). The account's email is the invitation's; the request
     cannot supply one.
5. **Claim** with a conditional update — `SET accepted_at` where it is still unaccepted,
   unrevoked, and unexpired. No row → `404`.
6. Create the account (new accounts), then the membership with the invited role.

Every failure in steps 1–4 happens before anything is written. A failure after the claim —
an address registered or a membership created concurrently, caught by its unique
constraint — throws inside the transaction and rolls the claim back. **A failed
acceptance never consumes an invitation.**

The claim is the concurrency boundary. The checks before it read state that may already be
stale, so the update re-asserts the conditions itself; Postgres serialises concurrent
updates of one row and re-evaluates the predicate for the one that waited. Of two
acceptances, or an acceptance racing a revocation or a replacement, exactly one wins; the
other is told what anyone holding an unusable token is told. The integration suite forces
each of these races deterministically by holding a transaction open until the request under
test is seen waiting on its lock.

Signup by invitation checks the token before hashing a password, so an unusable token costs
the server no Argon2 work. The session it starts is issued exactly as registration's is.

### Tokens

| Property | How |
| --- | --- |
| Unguessable | 32 bytes from the CSPRNG, base64url — the same generator as refresh tokens |
| Not stored | Only its SHA-256 is kept, in `token_hash` |
| Disclosed once | In the `201` that created the invitation, and in no other response |
| Never in a URL the server sees | API calls carry it in a `POST` body — request paths are logged. The browser link is `/invite#<token>`: a fragment is never sent to a server or put in a `Referer` |
| Never logged | Invitation log lines carry the invitation id, organization id, and role — never the token or the invitee's address |
| One answer for every unusable token | Unknown, expired, revoked, accepted, belonging to a deleted organization, or claimed by a concurrent request: `404 INVITATION_NOT_FOUND` |

**The limitation.** There is no email verification, so whoever holds a link may be able to
create the account for the invited address. The link is the credential until verification
exists. What contains it: a seven-day expiry, single use, revocation, replacement on
re-invite, the inviter's choice of how to share the link, and a warning shown with it.
Revisit this when mail delivery arrives.

### Tests

[`invitations.e2e-spec.ts`](apps/api/test/invitations.e2e-spec.ts) proves where each check
sits and which routes are public.
[`invitations.integration-spec.ts`](apps/api/test/invitations.integration-spec.ts) runs two
tenants against a real database: the one-open-invitation invariant under a burst of
concurrent creates and under a forced race; concurrent acceptance and signup on one token;
claims rolled back by conflicts that appear after them; the identity and inviter-reference
rules; and every service call with no guard in front of it.
[`invitations-logging.integration-spec.ts`](apps/api/test/invitations-logging.integration-spec.ts)
drives every route with the production JSON logger and asserts that no token or invitee
address is written.

---

## Teams

A team is a named group of an organization's members — the unit that owns services and
is responsible for incidents. An `OWNER` or `ADMIN` creates, renames, and deletes teams, and
places existing organization members on them; every member can see them.

### Endpoints

All under `/api/v1/organizations/:organizationId`, with admission, permission, and
isolation exactly as in [Tenancy](#tenancy) and [Authorization](#authorization).

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /teams` | `teams:read` | Every team, by name, each with `memberCount` and `serviceCount` |
| `POST /teams` | `teams:manage` | Create `{ "name", "description"? }`. `201` |
| `GET /teams/:teamId` | `teams:read` | One team |
| `PATCH /teams/:teamId` | `teams:manage` | Change `{ "name"?, "description"? }` (at least one; `null` clears the description) |
| `DELETE /teams/:teamId` | `teams:manage` | Delete the team; its members stay in the organization. `204`, or `409` while it owns services or once it has been responsible for an incident |
| `GET /teams/:teamId/members` | `teams:read` | Who is on it, by name: `{ membershipId, addedAt, user: { id, name, email } }` |
| `POST /teams/:teamId/members` | `teams:manage` | Add `{ "membershipId" }` — an existing member of this organization. `201` |
| `DELETE /teams/:teamId/members/:membershipId` | `teams:manage` | Take them off the team; they stay in the organization. `204` |

A team member is addressed by their **organization membership id** — the id
`GET /memberships` lists — so the path segment is `members`, and the team-membership row's
own id is never exposed. Bodies are strict: `slug`, `organizationId`, or `id` is a `400`.

### Invariants

- A team belongs to exactly one organization, and may be empty.
- A person is on a given team at most once, and on any number of teams.
- A team member is a member of the same organization — enforced by the database, see
  [Tenant consistency by composite foreign key](#tenant-consistency-by-composite-foreign-key).
- Names are unique within an organization. The **slug** is derived from the name at
  creation, never supplied or shown as content, and never changes — it exists for URLs and
  future internal references. Because it is derived and unique, a second team whose name
  differs only by case or punctuation (`Platform`, `platform!`) is refused at creation. A
  rename is held only to exact-name uniqueness. A name with nothing to derive a slug from
  (`決済`) gets an opaque one (`team-3fa9c1d2`).
- Members whose accounts were soft-deleted are neither listed, counted, nor addable.

### Errors

| Case | Answer |
| --- | --- |
| Team id malformed, missing, or in another organization | `404 TEAM_NOT_FOUND`, identically |
| `membershipId` not a current member of this organization | `404 MEMBERSHIP_NOT_FOUND` |
| Removing someone who is not on the team | `404 TEAM_MEMBER_NOT_FOUND` |
| Name taken, or too similar to one at creation | `409 TEAM_NAME_TAKEN` |
| Already on the team | `409 ALREADY_A_TEAM_MEMBER` |
| Deleting a team that owns services | `409 TEAM_OWNS_SERVICES` — nothing is deleted |
| Deleting a team that has been responsible for an incident | `409 TEAM_HAS_INCIDENTS` — nothing is deleted |

Every uniqueness rule is an index, so concurrent requests resolve to `409`, and an add
racing the team's deletion — refused by the composite foreign key — to `404`, never `500`.

### Deletion

Teams follow the [deletion principle](#deletion-two-different-mechanisms): deleting one
removes only who was on it. A team that owns services is not deleted — the services'
foreign key refuses it and the API answers `409 TEAM_OWNS_SERVICES` — until each service
is moved to another team. The refusal is not checked in advance, which would race a
service being assigned in between; the database decides.

A team that has been the responsible team on any incident — resolved ones included — is
never deleted: incidents are history, and their team key is `Restrict` too. The API
answers `409 TEAM_HAS_INCIDENTS`, and the team can still be renamed. Team archival would
be the way to retire one; it does not exist yet, deliberately, because keeping the team
costs nothing but a name.

### Not yet

Team leads, team roles or team-scoped permissions, nested teams, on-call, and team
archival.

### Tests

[`teams.e2e-spec.ts`](apps/api/test/teams.e2e-spec.ts) proves the wiring: every route is
admitted and authorized, and a `MEMBER` is refused every write before its body is read.
[`teams.integration-spec.ts`](apps/api/test/teams.integration-spec.ts) runs two tenants
against a real database: foreign team and membership ids answered exactly as missing ones
on every route, refused writes leaving rows untouched, the service isolating with no guard,
soft-deleted members, the constraint mapping against the real driver adapter, and races.
[`schema.integration-spec.ts`](apps/api/test/schema.integration-spec.ts) proves the
invariants in the database itself, including a cross-organization placement refused when
written as raw SQL.

---

## Services

A service is a system the organization runs — an API, a processor, a portal — owned by
one of its teams. It is what incidents are recorded against. An `OWNER` or `ADMIN`
creates, changes, reassigns, archives, and deletes services; every member can see them. The model is
industry-neutral: a payments company's `Payment API` and a shop's `Checkout Service` are
the same kind of record.

### What a service is

| Field | Why it exists |
| --- | --- |
| `name` | What people call it. Unique within the organization. |
| `description` | Optional: what it does, for someone who does not know it. |
| owner team | Who is responsible. **Required** — a service nobody owns is exactly the ambiguity an incident tool exists to remove. |
| `criticality` | How much the organization depends on it. Defaults to `NORMAL`. |
| `archivedAt` | When it was retired, or `null` while in use. See [Archival and deletion](#archival-and-deletion). |
| `slug` | Derived, for URLs only — the same rules as a team's. Never supplied or shown, never changed. A name with nothing to derive one from (`決済サービス`) gets an opaque slug (`service-3fa9c1d2`). |

**Criticality** is four plain words, defined so they mean the same thing in any
organization. It is a classification people choose — not health, not incident severity,
and nothing sorts or computes by it:

| Level | Meaning |
| --- | --- |
| `CRITICAL` | Failure stops the organization's core work or directly harms its customers |
| `HIGH` | Failure seriously degrades important work; workarounds are limited |
| `NORMAL` | Failure is disruptive but contained |
| `LOW` | Internal or peripheral; failure has little impact |

Words rather than numbered tiers, whose direction readers disagree about. The web app
shows them as text, never with the signal colours reserved for observed state.

**No health or status field.** Nothing could set one truthfully yet: a manual flag goes
stale, and deriving it needs incidents or monitoring. It arrives with the model that
gives it meaning.

### Endpoints

All under `/api/v1/organizations/:organizationId`, with admission, permission, and
isolation exactly as in [Tenancy](#tenancy) and [Authorization](#authorization).

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /services` | `services:read` | Every service, by name |
| `POST /services` | `services:manage` | Create `{ "name", "ownerTeamId", "description"?, "criticality"? }`. `201` |
| `GET /services/:serviceId` | `services:read` | One service |
| `PATCH /services/:serviceId` | `services:manage` | Change `{ "name"?, "description"?, "ownerTeamId"?, "criticality"?, "archived"? }` (at least one; `null` clears the description; the owner can be moved, never cleared; `archived: true` / `false` archives or unarchives) |
| `DELETE /services/:serviceId` | `services:manage` | Delete a service no incident names; its team is unaffected. `204`, or `409` when incidents name it |

A service is returned as `{ id, name, slug, description, criticality, ownerTeam: { id,
name, slug }, archivedAt, createdAt, updatedAt }`. Bodies are strict: `slug`,
`organizationId`, `id`, or `archivedAt` is a `400` — the client says whether the service
is archived, and the server records when.

### Invariants

- A service belongs to exactly one organization and is owned by exactly one team of that
  same organization — enforced by the database, see
  [Tenant consistency by composite foreign key](#tenant-consistency-by-composite-foreign-key).
- A team that owns services cannot be deleted, or moved to another organization.
- Names are unique within an organization; at creation, so is the derived slug, which
  refuses a name that differs only by case or punctuation.

### Errors

| Case | Answer |
| --- | --- |
| Service id malformed, missing, or in another organization | `404 SERVICE_NOT_FOUND`, identically |
| `ownerTeamId` malformed | `400`, naming the field |
| `ownerTeamId` missing, or another organization's team | `404 TEAM_NOT_FOUND`, identically |
| Name taken, or too similar to one at creation | `409 SERVICE_NAME_TAKEN` |
| Deleting a service that incidents name | `409 SERVICE_HAS_INCIDENTS` — nothing is deleted |
| Declaring an incident against an archived service | `409 SERVICE_ARCHIVED` (on the incident route) |

The service is judged before the team, so a service this organization lacks answers
`SERVICE_NOT_FOUND` whatever the body names. A create or reassignment racing the target
team's deletion resolves to `404 TEAM_NOT_FOUND` or to the team delete's `409`, never
`500` and never a service without an owner.

### Archival and deletion

**Archiving retires a service.** It sets `archivedAt` and carries exactly one rule: no
new incident can be declared against an archived service — refused by the server with
`409 SERVICE_ARCHIVED`, not merely hidden by the web app. Everything else is unchanged:
it is still listed (the web app shows it under **Archived**), still named by every
incident recorded against it, still renamable and reassignable, and those incidents can
still be worked and resolved. Unarchiving clears `archivedAt`. Archiving is allowed
while incidents on the service are active; they carry on.

**Deleting is for a service nothing references** — a mistake. A service that incidents
name cannot be deleted: their foreign key refuses it and the API answers
`409 SERVICE_HAS_INCIDENTS`. As for teams, this is not checked in advance, which would
race a declaration in between; the database decides. An archived service with no
incidents can still be deleted.

A declaration and an archive, a reassignment, or a delete of the same service never
interleave: declaring locks the service row until the incident is committed (see
[Declaring, and what it races](#declaring-and-what-it-races)).

### Not yet

Health or status, dependencies and topology, monitoring integrations, environments,
repositories, runbooks, tags and custom fields, templates, and archive reasons or who
archived a service.

### Tests

[`services.e2e-spec.ts`](apps/api/test/services.e2e-spec.ts) proves the wiring: every
route is admitted and authorized, and a `MEMBER` is refused every write before its body is
read. [`services.integration-spec.ts`](apps/api/test/services.integration-spec.ts) runs
two tenants against a real database: foreign service and team ids answered exactly as
missing ones, a team member granted nothing by owning a service, the service isolating
with no guard, the owner key recognised through the real driver adapter, and races
between services and their teams. [`schema.integration-spec.ts`](apps/api/test/schema.integration-spec.ts)
proves the invariants in the database itself: cross-organization ownership refused as
raw SQL on insert and on update, a null owner refused, team deletion and team moves
refused while services remain, and a physical organization deletion still completing.
Archival and the incident-driven delete refusal are proven in
[`incidents.integration-spec.ts`](apps/api/test/incidents.integration-spec.ts).

---

## Incidents

An incident is a real operational problem affecting one of the organization's services:
card payments failing on the Payment API, customers unable to check out. Someone notices
it — through support, a colleague, or their own monitoring — and **declares** it in
SentinelOps. SentinelOps does not detect incidents; declaring is a deliberate human act.

The model is industry-neutral. A payments company and a shop record incidents the same
way; what differs is only the teams and services they have.

### What an incident is

| Field | Why it exists |
| --- | --- |
| `number` | The organization's own sequence, shown as **INC-42**. The API addresses an incident by it. |
| `title` | What is happening, in a few words. Required. |
| `summary` | Optional: what is known so far — who is affected and how. |
| service | The affected service. Required, and **never changes** after declaration. |
| responsible team | Who is responsible for this incident. See below. |
| `severity` | How serious this incident is: `SEV1`–`SEV4`. Required — there is no default. |
| `status` | Where the response stands. Starts `INVESTIGATING`. |
| declared by | The member who declared it, by name. |
| `createdAt` | When it was declared. |
| `resolvedAt` | When it was resolved; set by the server, never by a client. |

An incident is returned as `{ id, number, title, summary, severity, status, service: {
id, name, slug, criticality, archivedAt }, team: { id, name, slug }, createdBy: { id,
name }, createdAt, updatedAt, resolvedAt }`. The declarer's email is never included.

### Severity is not criticality

A service's **criticality** says how much the organization depends on it, in general.
An incident's **severity** says how serious *this* incident is. They are chosen
independently — a `CRITICAL` service can have a `SEV4` incident — and severity is never
derived from criticality; the service's criticality is shown beside the incident as
context.

| Severity | Meaning |
| --- | --- |
| `SEV1` Critical | Core functionality unavailable, or major customer or business impact |
| `SEV2` Major | Serious degradation or substantial impact, short of a complete critical outage |
| `SEV3` Moderate | Limited or contained impact; normal operations largely continue |
| `SEV4` Minor | A small operational issue with little immediate impact |

Numbered, unlike criticality's words, because `SEVn` — `SEV1` the most severe — is the
vocabulary responders already use, and because a different form keeps a "critical
service" from being confused with a critical incident. The web app always writes the
word beside the code, and severity is the first thing drawn with the reserved signal
colours, each level with its own glyph shape.

### Lifecycle

| Status | Meaning |
| --- | --- |
| `INVESTIGATING` | The problem is known; its cause and fix are not |
| `IDENTIFIED` | The likely cause is known; remediation is under way |
| `MONITORING` | A fix or mitigation is in place; recovery is being watched |
| `RESOLVED` | The incident is over |

- Every incident starts `INVESTIGATING`. There is no separate "open": the problem is
  known the moment someone declares it.
- The three active statuses move **in any direction**. A fix that does not hold sends
  `MONITORING` back to `INVESTIGATING`; a forward-only machine would make people misreport.
- Any active status can move to `RESOLVED`, with the same `PATCH`. `resolvedAt` is set in
  the same write, and a database `CHECK` keeps the two consistent for any writer:
  `status = 'RESOLVED'` exactly when `resolved_at` is set.
- **`RESOLVED` is final.** Any change to a resolved incident — title included — is
  `409 INCIDENT_RESOLVED`. Reopening arrives with the incident timeline, where it will
  be recorded as an event rather than silently overwriting the first resolution. Until
  then, a problem that returns is a new incident.

### The responsible team is a snapshot

Every service has an owner team. When an incident is declared, the service's owner at
that moment becomes the incident's responsible team — stored on the incident, not read
through the service. So when the Payment API moves from Payments to Platform six months
later, its old incidents still say Payments was responsible, and new ones say Platform.

The responsible team can be **reassigned** while the incident is active — the owner of a
service is not always the right team to respond — to any team in the organization.
Until the incident timeline exists, a reassignment replaces the previous team without a
record of it. Names are read live: renaming a team shows on its past incidents, because
the team is the same one.

### Numbers

`INC-n` numbers are **per organization**, **unique**, **never changed or reused**, and
**increase** in the order declarations commit. They come from a counter on the
organization: declaring increments it in the same transaction that inserts the incident,
and the row lock that increment takes makes concurrent declarations in one organization
take turns — each gets a distinct, larger number, with no retry. Gaplessness is not
promised; nothing depends on it. The counter lives on the organization, not in a global
sequence, so one organization's numbers say nothing about another's activity.

Numbers are guessable, and that is fine: the organization is in the path, so an incident
number means nothing outside the organization it was admitted to.

### Endpoints

All under `/api/v1/organizations/:organizationId`, with admission, permission, and
isolation exactly as in [Tenancy](#tenancy) and [Authorization](#authorization). Every
role holds both permissions.

| Route | Permission | Purpose |
| --- | --- | --- |
| `GET /incidents?state=active` | `incidents:read` | Active incidents, most severe first, then longest-running |
| `GET /incidents?state=resolved` | `incidents:read` | Resolved incidents, most recently declared first |
| `POST /incidents` | `incidents:manage` | Declare `{ "title", "serviceId", "severity", "summary"? }`. `201` |
| `GET /incidents/:number` | `incidents:read` | One incident |
| `PATCH /incidents/:number` | `incidents:manage` | Change `{ "title"?, "summary"?, "severity"?, "status"?, "teamId"? }` of an active incident (at least one). `"status": "RESOLVED"` resolves it |

There is **no delete**. Incidents are history; a mistaken declaration is resolved.

Both lists are the first collections to use the envelope reserved in
[API conventions](#successful-responses-are-not-wrapped):

```jsonc
{ "items": [ /* incidents */ ], "page": { "cursor": "SEV2:41", "hasMore": true } }
```

Pages are 50 incidents; there is no `limit` parameter. `cursor` is opaque — pass it back
as `?cursor=` for the next page; it is `null` exactly when `hasMore` is false. Pages are
keyset reads over `(severity, number)` for active incidents and `number` for resolved
ones, so a deep page costs what the first does. An incident whose status or severity
changes between two page requests can be skipped or repeated; that is the nature of
paging a changing set, and the active list is rarely more than one page.

Declaring takes no `status` (every incident starts `INVESTIGATING`), no team (the
service's owner is responsible), and no number, declarer, or `resolvedAt`: bodies are
strict, and any of those is a `400`.

### Errors

| Case | Answer |
| --- | --- |
| Incident number malformed, missing, or not this organization's | `404 INCIDENT_NOT_FOUND`, identically |
| `serviceId` missing, or another organization's service | `404 SERVICE_NOT_FOUND`, identically |
| `serviceId` archived | `409 SERVICE_ARCHIVED` |
| `teamId` missing, or another organization's team | `404 TEAM_NOT_FOUND`, identically |
| Any change to a resolved incident | `409 INCIDENT_RESOLVED` |
| `state` missing or unknown; a malformed cursor | `400`; `400 INVALID_CURSOR` |
| `serviceId` or `teamId` not a uuid; a severity or status outside the enums | `400`, naming the field |

On a change, the incident is judged first (`404`, then `409`) and only then the team the
body names, so a foreign incident reveals nothing about the body.

### Declaring, and what it races

Declaring is one transaction that takes its locks in a fixed order — the organization
row, then the service row — so it cannot deadlock:

1. Increment the organization's counter: allocates the number, holds the organization
   row, and refuses an organization soft-deleted since admission.
2. Resolve the declarer from the admitted membership, within this organization.
3. Read the service's owner and archival **`FOR SHARE`**. Until commit, the service
   cannot be reassigned, archived, or deleted — and its owning team cannot be deleted,
   because it owns the locked service.
4. Insert the incident with the owner read in step 3 as its responsible team.

Step 3 is the only raw SQL in the application, for one reason: Prisma's query API cannot
express a locking read. It is a parameterized tagged template, scoped by organization.
`FOR SHARE` rather than the `FOR KEY SHARE` a foreign key already takes, because
`KEY SHARE` does not block an update of a non-key column, and `owner_team_id` and
`archived_at` are exactly what must not change underneath the declaration.

So a declaration and a change to its service happen one after the other, never
interleaved:

| Concurrent change | Committed first | Arrives while the declaration holds the lock |
| --- | --- | --- |
| Service deleted | `404 SERVICE_NOT_FOUND` | The delete waits, then is refused: `409 SERVICE_HAS_INCIDENTS` |
| Service reassigned | The incident gets the new owner | The reassignment waits; the incident gets the owner it was declared under |
| Service archived | `409 SERVICE_ARCHIVED` | The archive waits; the incident is declared, then the service is archived |
| Owning team deleted | Refused: `409 TEAM_OWNS_SERVICES` | Refused the same way |
| Another declaration | Distinct numbers, one after the other | — |

Of two concurrent resolutions, the second waits on the row, finds it already resolved,
and answers `409 INCIDENT_RESOLVED`; `resolvedAt` is written once. Other concurrent
changes are last-write-wins per field: a change sends only the fields it changes.

### Logging

`Incident declared`, `Incident updated`, and `Incident resolved`, each with the incident's
id and number and the service, team, severity, or status involved; an update names the
fields it changed. **Never the title or summary**: free text can hold customer names or
system details. See [Sensitive data](#sensitive-data).

### Not yet

The incident timeline — updates and notes, status, severity, and reassignment history,
who resolved it, reopening. Responders and an incident commander, when impact began, a
per-service or per-team incident list, the operational overview, and live updates.
Detection, alerts, paging, and notifications. Deleting or voiding an incident, changing
its service, and optimistic concurrency on edits.

### Tests

[`incidents.e2e-spec.ts`](apps/api/test/incidents.e2e-spec.ts) proves the wiring: every
route is admitted and authorized, every role may respond, bodies are strict, and there
is no delete route.
[`incidents.integration-spec.ts`](apps/api/test/incidents.integration-spec.ts) runs two
tenants against a real database: a member declaring, moving, and resolving; the
responsible team surviving a service reassignment; per-organization numbering under ten
concurrent declarations; both lists paged completely and in order; foreign incidents,
services, and teams answered exactly as missing ones; the service isolating with no
guard; archival refusing declarations; the delete refusals recognised through the real
driver adapter; and every race in the table above, forced deterministically by holding a
transaction open until the declaration is seen waiting on its lock.
[`incidents-logging.integration-spec.ts`](apps/api/test/incidents-logging.integration-spec.ts)
asserts no title or summary is logged, and
[`schema.integration-spec.ts`](apps/api/test/schema.integration-spec.ts) proves the
constraints themselves — including a physical organization deletion completing through
the `Restrict` keys.

---

## Web application

`apps/web` is a Next.js 16 App Router app. Authenticated pages render in the browser and
call the API directly, using the CORS policy described in
[Configuration](#configuration); there is no proxy or backend-for-frontend. Working on the
app — its layout, request kinds, query keys, and UI foundation — is covered in
[`apps/web/README.md`](apps/web/README.md).

### How the browser holds a session

| | Access token | Refresh token |
| --- | --- | --- |
| Held in | Module memory in each tab | The API's `HttpOnly` cookie, which script never reads |
| Survives a reload | No — restored by a refresh on load | Yes |
| Sent with | Every organization, invitation-acceptance, and `/auth/me` request, as `Authorization: Bearer` | Only the session requests: register (either kind), login, refresh, logout |

The API client has three request kinds, and every endpoint picks one explicitly. Session
requests use `credentials: 'include'` — which a browser requires both to send the cookie
*and* to store one set by a cross-origin response — and never carry a bearer token, and
never refresh on `401`. Authenticated requests use `credentials: 'omit'`, so the cookie
never travels with them (its `Path=/api/v1/auth` would otherwise match `/auth/me`), and a
`401` gets at most one refresh and one retry. Public requests — only the invitation lookup —
carry neither the cookie nor a token, and never refresh.

Because the API revokes a whole token family when a refresh cookie is used twice,
refreshes never overlap: single-flight within a tab, and serialized across tabs by an
exclusive Web Lock held until the response has been read. Several tabs refreshing together
therefore make several sequential refreshes and each hold their own access token. Where
Web Locks is unavailable (it requires a secure context), or a tab unloads mid-refresh, the
user can be signed out; nothing is exposed. The rotation and reuse-detection rules in
[Authentication](#authentication) are unchanged.

Hiding a control the caller's permissions do not include is a convenience. Every request
is still authorized by the API, with the same `403`/`404` answers as for any other client.

### Deployment constraint: one site

The refresh cookie is `SameSite=Lax`, so a browser only sends it to the API when the web
app and the API are on the **same site** — the same scheme and registrable domain:

| Web app | API | Works |
| --- | --- | --- |
| `http://localhost:3000` | `http://localhost:3001` | Yes — the port does not change the site |
| `https://app.example.com` | `https://api.example.com` | Yes |
| `http://127.0.0.1:3000` | `http://localhost:3001` | No — different sites, and not in `CORS_ORIGIN` |
| `https://sentinelops.vercel.app` | `https://sentinelops-api.onrender.com` | No — each is its own site under a public suffix, and third-party cookie blocking applies as well |

`CORS_ORIGIN` must list the web app's exact origin. The web app's own configuration is
`NEXT_PUBLIC_API_URL`, the API origin, set in `apps/web/.env.local`; it is inlined at build
time and a build without it fails.

### Not yet

- Browser end-to-end tests and CI.
- A Content Security Policy. The app sends `X-Content-Type-Options`, `Referrer-Policy`,
  and `X-Frame-Options: DENY`; a nonce-based CSP is later work.
- Telling other tabs about a logout. They keep working until their access token expires
  and their next refresh fails.

---

## Logging

The API logs through NestJS's own `Logger`, backed by a single application logger
([`apps/api/src/logger/app.logger.ts`](apps/api/src/logger/app.logger.ts)) that extends
Nest 12's `ConsoleLogger`. It is installed once in `main.ts` with `app.useLogger()`, so
every `new Logger(Context)` in the codebase — and Nest's own framework output — routes
through it. **No dependency was added:** JSON output, level filtering, and structured
fields all ship with the framework.

### How a module logs

Exactly as it would without any of this. Nothing imports or injects the application
logger:

```ts
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  async update(/* … */) {
    // …
    this.logger.log('Incident resolved', {
      incidentId: incident.id,
      incidentNumber: incident.number,
      severity: incident.severity,
    });
  }
}
```

A plain object as the last argument becomes structured fields on the entry. The
correlation id is added by the logger, not by the caller.

### Format

`LOG_FORMAT=json` — one machine-parseable line per entry, the production default:

```json
{"level":"log","pid":8123,"timestamp":1757328000000,"message":"Incident resolved","context":"IncidentsService","requestId":"0f9c1e2a-…","userId":"0199…","organizationId":"0199…","incidentId":"0199…","incidentNumber":42,"severity":"SEV1"}
```

`LOG_FORMAT=pretty` — the colourised Nest format, the development and test default:

```text
[Nest] 8123  - 09/08/2026, 4:20:11 PM     LOG [IncidentsService] Incident resolved { requestId: '0f9c1e2a-…', incidentId: '0199…', incidentNumber: 42, severity: 'SEV1' }
```

Structured fields sit at the JSON root rather than nested under `params`, so an aggregator
indexes them directly. Nest's own keys win on collision — a field named `message` cannot
displace the real one.

### Levels

`LOG_LEVEL` names the **minimum**; every level at or above it is enabled.

| Level | Used for |
| --- | --- |
| `error` | 5xx responses (with stack); failed database connect; failed readiness probe |
| `warn` | 4xx responses at the HTTP layer |
| `log` | 2xx/3xx requests; lifecycle events |
| `debug` | 4xx detail from the exception filter |
| `verbose` | Reserved; nothing emits it yet |
| `fatal` | Reserved for unrecoverable startup failure |

### Request correlation

`RequestIdMiddleware` publishes the request id it already assigns
(see [API error responses](#api-error-responses)) as ambient context, using Node's
`AsyncLocalStorage` ([`apps/api/src/common/request-context.ts`](apps/api/src/common/request-context.ts)).
The logger reads it from there, so **a service logs a correlated line without being handed
the request**:

```
X-Request-Id: 0f9c1e2a-…   ← response header
{ "requestId": "0f9c1e2a-…" } ← error response body
{"level":"log", …,"requestId":"0f9c1e2a-…"} ← every log line for that request
```

Two more ambient fields join it as the request progresses: `userId` once `JwtAuthGuard` has
verified a token, and `organizationId` once a request has been admitted to an organization.
Each is absent until then — on public routes, failed authentications, and routes that are
not organization-scoped. The membership id and role are never logged.

Outside a request — bootstrap, shutdown, background work — the field is simply absent
rather than filled with an id that would correlate with nothing.

### Two records per failed request

A failed request produces two lines, on purpose, sharing one `requestId`:

| Source | Record | Answers |
| --- | --- | --- |
| `HttpLoggerMiddleware` | Lifecycle: `method`, `path`, `statusCode`, `durationMs` | Did the request arrive, and how did it end? |
| `AllExceptionsFilter` | Diagnostic: the error message and, for 5xx, the stack | Why did it fail? |

The access record is a middleware rather than an interceptor so that unmatched routes —
where an access log is most often consulted — are covered too.

### Sensitive data

**Request bodies, response bodies, and headers are never logged.** The only header that
reaches a log is the correlation id. This rule is the actual control. It extends to
structured fields a service chooses to log: free text a user wrote — an incident's title
or summary — is never one of them, because redaction matches keys, not content.
Identifiers and enum values are.

Redaction is the backstop behind it: every structured field passes through
[`apps/api/src/logger/redact.ts`](apps/api/src/logger/redact.ts), which masks the value of
any key matching `password`, `secret`, `token`, `apiKey`, `authorization`, `cookie`,
`session`, `jwt`, `credential`, `privateKey`, `refreshToken`, `accessToken`,
`clientSecret`, `otp`, `pin`, or `ssn` — case-insensitively, and as a substring, so
`refresh_token` and `X-Api-Key` match too. Sensitive query-string values are masked the
same way while their keys are kept, so `?token=…&page=2` stays diagnosable without the
credential.

Redaction is applied in one place — the logger's single output funnel — so it covers both
formats, every level, and every call site, including ones written later that never
considered it. It is a safety net, not permission to log a payload.

---

## Documentation

Project documentation lives in [`docs/`](docs/). It is currently empty; architecture
decisions, API references, and operational runbooks will be added there as the project
develops.

---

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 jui-dev.
