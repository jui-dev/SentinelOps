# @sentinelops/web

The SentinelOps web app: Next.js 16 (App Router), React 19, Tailwind CSS 4, and TanStack
Query. It talks to the API directly from the browser. The root [README](../../README.md#web-application)
describes the auth model and the deployment constraint it implies; this file covers
working on the app itself.

> Next.js 16 differs from older versions in places. Read the guides bundled in
> `node_modules/next/dist/docs/` before relying on memory — see [AGENTS.md](AGENTS.md).

## Running it

```bash
cp .env.example .env.local        # in apps/web — Next does not read the root .env
pnpm --filter @sentinelops/api start:dev
pnpm --filter @sentinelops/web dev
```

Open <http://localhost:3000> — `localhost`, not `127.0.0.1`: the API's `CORS_ORIGIN`
lists `http://localhost:3000`, and the two hosts are different sites to a browser.

| Script | Purpose |
| --- | --- |
| `dev` | Development server (Strict Mode is on, as in every App Router app) |
| `build` / `start` | Production build and server |
| `lint` | ESLint |
| `typecheck` | Generates route types (`next typegen`), then `tsc --noEmit` |
| `test` | Vitest + React Testing Library, jsdom. No API or database needed |

`NEXT_PUBLIC_API_URL` is validated when the app loads and inlined at build time, so a
build without it fails rather than shipping a bundle that points nowhere.

## Layout

```
src/
├── app/                      routes — thin server files that render client components
│   ├── (auth)/login, register
│   ├── (app)/                signed-in shell: RequireSession + AppShell
│   │   └── orgs/[orgSlug]/   overview, members (and invitations), settings
│   ├── invite/               invitation acceptance — outside both groups
│   └── page.tsx              `/` redirects to login, the only org, or /orgs
├── components/
│   ├── ui/                   Button, Field, Alert, Spinner — nothing more yet
│   ├── app/, auth/, organizations/, invitations/
└── lib/
    ├── config/env.ts         validated public config
    ├── api/                  transport, the two request kinds, endpoints, contracts
    ├── auth/                 token store, refresh coordination, session provider
    └── query/                the QueryClient defaults
```

## The API client

Every endpoint function in [`lib/api/endpoints.ts`](src/lib/api/endpoints.ts) uses one
of three request kinds, and that choice is its whole auth policy:

| | `publicRequest` | `sessionRequest` | `authenticatedRequest` |
| --- | --- | --- | --- |
| For | invitation lookup | register (both kinds), login, refresh, logout | `/auth/me`, invitation acceptance, every `/organizations/…` route |
| `credentials` | `omit` | `include` — the refresh cookie is sent and stored | `omit` — the cookie never travels |
| `Authorization` | never | never | `Bearer <in-memory token>` |
| On `401` | returned as an error | returned as an error | at most one refresh and one retry |

`authenticatedRequest` treats only `401` specially:

```
request → 401 → one refresh (or a token another request just obtained) → one retry → final
```

A refused retry, or a refresh the API refuses, ends the session. A refresh that cannot
reach the API does not — an outage says nothing about whether the session is valid. `403`
and `404` are returned to the caller untouched. Refresh is itself a `sessionRequest`, so it
cannot recurse.

Errors arrive as `ApiError` (`statusCode`, `code`, `message`, `details`, `requestId`) or
`NetworkError`. Contract types are hand-written in
[`lib/api/contracts.ts`](src/lib/api/contracts.ts) — keep them in step with the API's
`*.contract.ts` files.

## Sessions

- The access token lives in module memory only. Nothing is written to `localStorage`,
  `sessionStorage`, or a cookie; a reload restores the session from the refresh cookie.
- **Refresh coordination.** The API revokes a whole token family when a refresh cookie is
  used twice, so refreshes must never overlap:
  - within a tab they are single-flight — concurrent callers share one request, which
    also absorbs Strict Mode's double effects;
  - across tabs the request runs under an exclusive Web Lock held until the response body
    is read. Tabs refresh one after another, each with the cookie the previous one stored.
    That is serialization, not sharing: N tabs make N refreshes and hold N access tokens.
- **Where that is not enough.** Web Locks needs a secure context (`localhost` qualifies; a
  plain-http LAN address does not), and a tab that unloads after the server rotated but
  before the response arrived leaves the browser with a revoked cookie. Either can sign the
  user out. Neither exposes anything.
- Session states are `loading`, `authenticated`, `unauthenticated`, and `unavailable`
  (the API could not answer — the user gets a retry, not a login form).
- Logout clears the token and the whole query cache. Other open tabs keep their own access
  token until it expires (15 minutes at most), then fail to refresh and sign out.
- After an explicit logout the user goes to a bare `/login`; otherwise the login page gets
  a `?next=` path, accepted only if it is a same-origin path.

## Organizations and permissions

URLs use the slug; the API is addressed by id. `OrganizationScope` resolves the slug from
the caller's own memberships in `/auth/me` — a slug they do not belong to never produces a
request — and shows not-found for anything unresolvable, or when the API answers `404`.

What to offer is decided from `membership.permissions` on `GET /organizations/:id`,
through `useCan(permission)`. The app knows permission **names** only; it never maps roles
to permissions. Hiding a control is a convenience — the API authorizes every request.

## Invitations

The Members page offers an invite form (`invitations:manage`) and the open-invitation list
(`invitations:read`, with Revoke for `invitations:manage`). A created invitation's link,
`<origin>/invite#<token>`, is shown once in a read-only field with a copy button. The token
lives only in that component's state until **Done**: the create mutation has `gcTime: 0`
and is reset once the link is taken, and the link is never an `href`.

`/invite` sits outside both route groups, so it works signed out without `(app)`'s
redirect to login, and signed in without `(auth)`'s redirect away. It reads the token from
the URL **fragment**, which the browser never sends to Next or the API and never puts in a
`Referer`, and sends it only in request bodies. The lookup result lives in the page's own
state rather than the query cache, so no cache holds the token or what it unlocks — and
signing in, which clears the cache, does not look the invitation up again. The page offers:

- signed out: **create an account** (the email is fixed to the invited one) or **sign in**
  inline — not through `/login?next=`, which would put the token in a query string. A `409
  EMAIL_ALREADY_REGISTERED` switches to sign-in;
- signed in as the invited address: **Join**, after which `me` is refetched before
  navigating, because the organization scope resolves slugs from it;
- signed in as someone else: an explanation and **Log out**, which returns to the
  signed-out view on the same page;
- anything unusable: one "invitation not available" state.

## Query keys

Defined in [`lib/api/query-keys.ts`](src/lib/api/query-keys.ts). Invalidate by what a
write actually changes: a rename merges the new name into `['organization', id]` and
invalidates `['me']` (whose memberships embed organization names), and leaves
`['organization', id, 'memberships']` alone. Creating or revoking an invitation
invalidates only `['organization', id, 'invitations']`; accepting one refetches `['me']`.
No query key ever contains an invitation token.
