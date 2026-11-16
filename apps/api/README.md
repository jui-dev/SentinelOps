# @sentinelops/api

The SentinelOps API: NestJS 12 on Express 5, PostgreSQL through Prisma 7, and Zod 4
validation. Every route is served under `/api/v1`.

How it is built — modules, the path of a request, error and logging conventions — is in
[docs/architecture.md](../../docs/architecture.md#the-api). Authentication, tenancy, and
permissions are in [docs/security.md](../../docs/security.md), and the schema in
[docs/data-model.md](../../docs/data-model.md).

## Running it

From the repository root, with `.env` copied from `.env.example`:

```bash
pnpm db:up                                        # PostgreSQL in Docker
pnpm --filter @sentinelops/api prisma:migrate     # apply migrations
pnpm --filter @sentinelops/api prisma:generate    # generate the Prisma client
pnpm --filter @sentinelops/api start:dev          # http://localhost:3001, watching for changes
```

`GET /api/v1/health` answers once the process is up, and `GET /api/v1/health/ready` once
the database is reachable too.

## Scripts

| Script | Purpose |
| --- | --- |
| `start:dev` | Run with watch mode (`dev` is the same) |
| `build` / `start:prod` | Generate the Prisma client and compile; run the compiled output |
| `typecheck` / `typecheck:test` | TypeScript for the source, and for source plus tests |
| `lint` | oxlint |
| `format` / `format:check` | Prettier |
| `test` | Unit tests — no database |
| `test:e2e` | The real application module over HTTP, with a mocked database |
| `test:integration` | Against a real PostgreSQL (`TEST_DATABASE_URL`) |
| `prisma:migrate` / `prisma:status` / `prisma:generate` / `prisma:studio` | Prisma |
| `demo -- <command>` | Manage the local demo workspace — see [docs/development.md](../../docs/development.md#the-demo-workspace) |

## Layout

```
src/
├── main.ts                 bootstrap: logger, prefix, CORS, trusted proxies
├── app.module.ts           every module, and the validated configuration
├── auth/                   sign-in, sessions, passwords, sign-in limits
├── tenancy/                admitting a request to an organization
├── authorization/          permissions and the role-to-permission table
├── organizations/          the organization and its members
├── teams/  services/  known-issues/
├── incidents/              lifecycle, response, timeline, history and analytics
├── incident-analyses/      post-incident analyses
├── notifications/  activity/  invitations/  health/
├── common/                 error contract, request context, security headers
├── logger/                 the application logger and redaction
├── config/                 environment schema and configuration domains
├── database/               the Prisma service
├── dev/                    demo workspace — development only
└── generated/              Prisma client (generated, not committed)
prisma/
├── schema.prisma
└── migrations/
test/                       end-to-end and integration suites
```
