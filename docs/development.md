# Development

Everything needed to run SentinelOps on your own machine, change it, and check your work.

- [Prerequisites](#prerequisites)
- [First run](#first-run)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [The demo workspace](#the-demo-workspace)
- [Creating a real organization](#creating-a-real-organization)
- [Tests and checks](#tests-and-checks)
- [Continuous integration](#continuous-integration)

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 22 (see `.nvmrc`; at least 20.11) |
| pnpm | 11 — pinned in `package.json`; `corepack enable` picks the right version |
| Docker | Any recent version with Compose v2 — runs PostgreSQL |

Nothing else is installed on the host: PostgreSQL runs in a container.

## First run

```bash
pnpm install

cp .env.example .env                              # API, Prisma, and Docker Compose
cp apps/web/.env.example apps/web/.env.local      # the web app reads its own

pnpm db:up                                        # PostgreSQL in Docker
pnpm --filter @sentinelops/api prisma:migrate     # apply the migrations
pnpm --filter @sentinelops/api prisma:generate    # generate the Prisma client

pnpm dev                                          # API :3001 and web :3000 together
```

Open <http://localhost:3000>. Use `localhost` rather than `127.0.0.1`: the API only accepts
credentialed requests from the origins in `CORS_ORIGIN`, and to a browser the two hosts are
different sites.

The two apps can also be run separately:

```bash
pnpm --filter @sentinelops/api start:dev
pnpm --filter @sentinelops/web dev
```

The placeholder `JWT_SECRET` in `.env.example` is long enough to boot, which is all local
development needs. Anywhere else, generate a real one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Configuration

### API — `.env` at the repository root

The API validates its environment once at startup with a Zod schema
([`env.validation.ts`](../apps/api/src/config/env.validation.ts)) and refuses to boot
with a missing or invalid value, naming every problem at once.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** `postgresql://` connection string |
| `JWT_SECRET` | — | **Required.** At least 32 characters |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3001` | |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated web app origins |
| `TRUST_PROXY_HOPS` | `0` | Reverse proxies in front of the API — see [security](security.md#sign-in-limits) |
| `JWT_ISSUER` | `sentinelops` | The `iss` claim, signed and verified |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime |
| `LOG_LEVEL` | from `NODE_ENV` | `debug` in development, `log` in production, `warn` in tests |
| `LOG_FORMAT` | from `NODE_ENV` | `pretty` in development and tests, `json` in production |
| `INVITATIONS_ENABLED` | `false` | Email-style invitation links (kept for when email delivery exists) |
| `REGISTRATION_ENABLED` | `false` | Whether anyone may create an organization from the website |
| `TEST_DATABASE_URL` | — | The integration suite's own database; its name must end in `_test` |

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT` are read by
Docker Compose, not by the API. Keep them in step with `DATABASE_URL`.

### Web app — `apps/web/.env.local`

Next.js reads its environment from `apps/web`, not from the root.

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | — | **Required.** The API origin, e.g. `http://localhost:3001` |
| `NEXT_PUBLIC_INVITATIONS_ENABLED` | `false` | Must match the API's `INVITATIONS_ENABLED` |
| `NEXT_PUBLIC_REGISTRATION_ENABLED` | `false` | Must match the API's `REGISTRATION_ENABLED` |

`NEXT_PUBLIC_` values are inlined into the browser bundle at build time — never put a
secret in one.

## Database and migrations

```bash
pnpm db:up      # start PostgreSQL in the background
pnpm db:logs    # follow its logs
pnpm db:down    # stop it — data is kept in the sentinelops-postgres-data volume
```

The schema is [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). The
Prisma client is generated into `apps/api/src/generated/` and is not committed. `build`
regenerates it; otherwise run `prisma:generate` after cloning and after any schema change.

| Script (`pnpm --filter @sentinelops/api …`) | Does |
| --- | --- |
| `prisma:migrate --name <name>` | Create a migration from schema changes and apply it |
| `prisma:status` | Show which migrations are applied |
| `prisma:generate` | Regenerate the Prisma client |
| `prisma:studio` | Browse the database |
| `exec prisma migrate reset` | Drop and recreate the development database |

The API also answers `GET /api/v1/health` (the process is up) and
`GET /api/v1/health/ready` (the process **and** the database; `503` when PostgreSQL is
unreachable).

## The demo workspace

When the API starts with `NODE_ENV=development`, it makes sure a sample organization,
**AcmePay**, exists with these accounts. All use the password `dev-password-123`, and the
sign-in page lists them for a one-click sign-in.

| Account | Name | Role | Teams |
| --- | --- | --- | --- |
| `admin@example.com` | Dev Admin | Admin | — |
| `ava@example.com` | Ava Kim | Incident Manager | — |
| `alex@example.com` | Alex Rivera | Reporter | — |
| `priya@example.com` | Priya Shah | Responder | Payments |
| `sam@example.com` | Sam Okafor | Responder | Payments, Risk |
| `lee@example.com` | Lee Chen | Responder | Platform |
| `jordan@example.com` | Jordan Diaz | Responder | Risk |

AcmePay is marked as a demo organization and is never created in `test` or `production`.
Its content is made of parts, some required for the rest to make sense:

| Part | Required | Holds |
| --- | --- | --- |
| `accounts` | ✓ | The organization and the accounts above — always kept |
| `teams` | ✓ | Payments, Platform, and Risk, with their people |
| `services` | ✓ | Payment API, Authentication, and Fraud Detection |
| `knownIssues` | | Recurring problems per service |
| `history` | | About 26 weeks of resolved incidents |
| `live` | | Five incidents still in progress |
| `analyses` | | Post-incident analyses for past incidents |
| `activity` | | Activity log entries |

The Admin manages them from **Settings › Demo workspace**, or from the command line:

```bash
pnpm --filter @sentinelops/api demo -- status            # what each part holds
pnpm --filter @sentinelops/api demo -- reset             # everything, history ending today
pnpm --filter @sentinelops/api demo -- remove-all        # every part but the accounts
pnpm --filter @sentinelops/api demo -- generate history  # one part, and what it needs
pnpm --filter @sentinelops/api demo -- remove live       # one part, and what needs it
```

The command refuses to run unless `NODE_ENV` is `development` and `DATABASE_URL` points at
this machine. The demo code lives in `apps/api/src/dev/`.

## Creating a real organization

Public sign-up is off by default: organizations are created by whoever runs the server.
To create one, set `REGISTRATION_ENABLED=true` in `.env` and
`NEXT_PUBLIC_REGISTRATION_ENABLED=true` in `apps/web/.env.local`, restart both apps, use
**Create an organization** on the sign-in page, then switch both back off. The person who
creates it becomes its Admin and adds everyone else.

## Tests and checks

| Command | Runs | Needs |
| --- | --- | --- |
| `pnpm typecheck` | TypeScript across both apps | — |
| `pnpm lint` | oxlint (API) and ESLint (web) | — |
| `pnpm --filter @sentinelops/api format:check` | Prettier on the API | — |
| `pnpm test` | API unit tests and web tests | — |
| `pnpm --filter @sentinelops/api test:e2e` | The real API module over HTTP, with a mocked database | — |
| `pnpm --filter @sentinelops/api test:integration` | Services, constraints, and races against PostgreSQL | `pnpm db:up` |
| `pnpm build` | Production builds of both apps | — |

The integration suite uses its own database, named by `TEST_DATABASE_URL`, and creates
and migrates it on the first run. Because it empties tables between tests, it refuses to
start unless that database's name ends in `_test` and differs from `DATABASE_URL`'s.

On a machine with little memory, the web tests can be run a folder at a time, e.g.
`pnpm --filter @sentinelops/web exec vitest run src/components/incidents`.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main`
and every pull request, as two parallel jobs:

- **API** — typecheck, lint, formatting, unit, end-to-end, and integration tests against a
  PostgreSQL 18 service container, then the build.
- **Web** — typecheck, lint, tests, and the build.
