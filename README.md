# SentinelOps

A real-time incident and operations management platform. SentinelOps is intended to give
engineering and operations teams a single place to detect, triage, and resolve production
incidents — routing alerts to the right responders, tracking incident timelines as they
unfold, and turning the result into reviewable operational records.

---

## Project status

> **Early development.** The backend's foundations are in place and tested. There is no
> product yet: no incidents, no services, no teams, and no user interface.

Anything still described as **planned** below has not been built. Each piece is introduced
deliberately, and this README is updated as capabilities actually land.

**What exists today**

- A NestJS API on Express 5, with typed configuration, a single error contract, request
  validation, structured logging, and request correlation
- PostgreSQL via Prisma 7, with the core domain schema and its migrations
- Authentication: registration, login, refresh with rotation, logout, and a global guard
- A Next.js frontend scaffold, untouched beyond its default page
- Unit, end-to-end, and integration test suites

**What does not exist yet**

- Authorization: `Role` is stored and returned, but nothing enforces it
- Any tenant-scoped resource: no organizations, teams, services, or incidents API
- Rate limiting on authentication, which waits for Redis
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

The intended scope, not a feature list. Only the item marked below is built.

- **Multi-organization architecture** — tenant isolation across organizations. The schema
  carries `organizationId`; nothing enforces the scoping yet
- **Authentication** — ✅ registration, login, refresh with rotation, logout, and a global
  guard. See [Authentication](#authentication)
- **Authorization and role-based access control** — roles and granular permissions.
  `Role` is stored and returned; nothing reads it
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

```
sentinelops/
├── apps/
│   ├── api/           # NestJS backend
│   └── web/           # Next.js frontend (scaffold)
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

# Checks
pnpm --filter @sentinelops/api typecheck
pnpm --filter @sentinelops/api lint
pnpm --filter @sentinelops/api test              # unit, no database
pnpm --filter @sentinelops/api test:e2e          # no database
pnpm --filter @sentinelops/api test:integration  # needs pnpm db:up
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
hang off these. A fourth table, `refresh_tokens`, holds sessions rather than domain data.

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
```

`users.password_hash` is nullable, and deliberately so: a user invited to an organization
exists before choosing a password, and a federated identity may never have one. Login
treats null exactly as it treats a wrong password.

`refresh_tokens` is a row per *token*, not per session, because rotation makes a session a
chain: every refresh revokes the presented token and inserts its successor. See
[Authentication](#authentication).

### One identity, many organizations

A `User` is **global, not tenant-scoped**: one row per person, one globally unique email,
one login. Belonging to an organization is a `Membership`, and a person may hold a
different role in each. `@@unique([organizationId, userId])` means a user has exactly one
capacity per organization — nobody is both `ADMIN` and `MEMBER`.

`Role` is `OWNER`, `ADMIN`, `MEMBER`. It is the **initial coarse organization-level role
and an authorization extension point**, not a commitment to the eventual authorization
model — a later stage may add dedicated role or permission structures that read it,
supersede it, or migrate it away. Nothing enforces it yet; it is data.

### Deletion: two different mechanisms

| Entity | Application lifecycle | Physical `DELETE` |
| --- | --- | --- |
| `Organization` | **Soft** — set `deleted_at` | Cascades to memberships |
| `User` | **Soft** — set `deleted_at` | Cascades to memberships |
| `Membership` | **Hard** — the row is removed | n/a |

The **ordinary** delete of an organization or user writes `deleted_at`. That is an
`UPDATE`, touches no foreign key, and therefore **preserves memberships and every
historical relationship** — which is the point: a departed responder must still resolve as
the author of a past incident.

`ON DELETE CASCADE` is referential integrity for a **physical** row deletion — an erasure
request, a local reset. It is the exceptional path, not the normal one.

Membership is hard-deleted because revoking access must actually revoke it: a soft-deleted
grant that some future authorization check forgets to filter is a security hole, not a
data-loss risk.

Reads must filter on `deleted_at IS NULL`. That filtering is **not** built yet — there are
no read paths — and arrives with the first query.

### Conventions every later table follows

| Convention | Reason |
| --- | --- |
| snake_case tables and columns via `@@map` / `@map` | Raw SQL and `psql` read naturally without quoting every identifier. |
| `@default(uuid(7))` in `@db.Uuid` columns | 16 bytes rather than a 36-character string, and time-ordered, so primary-key inserts stay local in the btree. |
| `@db.Timestamptz(3)` on every timestamp | Prisma maps `DateTime` to `timestamp` **without** time zone by default. |
| Plain `text` for strings | Length limits live in the Zod schemas at the request boundary, where this project already validates. |
| Tenant-owned tables carry `organizationId` | The isolation convention. Enforcement arrives with the first read path. |

Only `memberships.user_id` is separately indexed. `organization_id` needs no index of its
own — it is the leading column of the composite unique, which already serves prefix lookups
and the cascade from `organizations`.

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
  "code": "INCIDENT_ALREADY_RESOLVED", // optional, only when the thrower sets one
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
export const createIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
});
export type CreateIncident = z.infer<typeof createIncidentSchema>;

@Post()
create(@Body({ schema: createIncidentSchema }) body: CreateIncident) { … }
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
  promise more than it holds. When the context later gains organization and role, such a
  decorator joins this one rather than replacing it.
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

### Known gaps

- **No rate limiting on login.** The honest gap. In-memory throttling is close to useless
  across multiple instances, so this waits for Redis rather than shipping a false sense of
  coverage.
- **No authorization.** `Role` is stored and returned; nothing enforces it.
- **No email verification or password reset.** Both need mail delivery.
- **Expired refresh tokens are not reaped.** They are rejected on use; deleting them needs
  a scheduler.

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

  async escalate(id: string) {
    this.logger.log('Incident escalated', { incidentId: id, tier: 2 });
  }
}
```

A plain object as the last argument becomes structured fields on the entry. The
correlation id is added by the logger, not by the caller.

### Format

`LOG_FORMAT=json` — one machine-parseable line per entry, the production default:

```json
{"level":"log","pid":8123,"timestamp":1757328000000,"message":"Incident escalated","context":"IncidentsService","requestId":"0f9c1e2a-…","incidentId":"inc_1","tier":2}
```

`LOG_FORMAT=pretty` — the colourised Nest format, the development and test default:

```text
[Nest] 8123  - 09/08/2026, 4:20:11 PM     LOG [IncidentsService] Incident escalated { requestId: '0f9c1e2a-…', incidentId: 'inc_1', tier: 2 }
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
reaches a log is the correlation id. This rule is the actual control.

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
