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

**Validation is fail-fast.** An invalid or missing value aborts startup before the HTTP
server binds, naming every offending variable at once:

```text
Error: Config validation error: PORT: Invalid input: expected number, received NaN
```

Because `DATABASE_URL` is required, **`cp .env.example .env` is a prerequisite** for
`start`, `start:dev`, and `test:e2e` — not just for Prisma. Unit tests (`pnpm test`) do not
need it.

### Configuration domains

Domains are declared in [`apps/api/src/config/configuration.ts`](apps/api/src/config/configuration.ts).

| Domain | Value | Type |
| --- | --- | --- |
| `app.port` | Port the API listens on | `number` |
| `app.environment` | Active environment | `'development' \| 'test' \| 'production'` |
| `database.url` | PostgreSQL connection string | `string` |
| `logging.level` | Minimum level to emit | `LogLevel` |
| `logging.format` | Output format | `'json' \| 'pretty'` |

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

> **No migrations exist yet, by design.** The schema deliberately declares no models. The
> first migration will be created alongside the first real SentinelOps domain model, so
> the migration history begins with meaningful state instead of a placeholder. Until then
> `prisma:status` reports `No migration found in prisma/migrations` — that is the
> expected result, not a failure.

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
