# @sentinelops/web

The SentinelOps web app: Next.js 16 (App Router), React 19, Tailwind CSS 4, and TanStack
Query. Its pages run in the browser and call the API directly. How it fits with the API —
and the one-site deployment constraint that follows — is in
[docs/architecture.md](../../docs/architecture.md#the-web-app).

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
| `dev` | Development server |
| `build` / `start` | Production build and server |
| `lint` | ESLint |
| `typecheck` | Generates route types (`next typegen`), then `tsc --noEmit` |
| `test` | Vitest + React Testing Library in jsdom. No API or database needed |

`NEXT_PUBLIC_API_URL` is validated when the app loads and inlined at build time, so a
build without it fails rather than shipping a bundle that points nowhere.

## Layout

```
src/
├── app/                        routes — thin files that render feature components
│   ├── (sign-in)/login
│   ├── (auth)/change-password, register
│   ├── (app)/orgs/[orgSlug]/   the signed-in workspace: overview, incidents, history,
│   │                           services, teams, members, roles, known issues, activity,
│   │                           how it works, settings
│   └── invite/                 invitation acceptance (when invitations are on)
├── components/
│   ├── ui/                     shared primitives: buttons, tables, dialogs, filters, …
│   ├── app/                    the workspace shell and navigation
│   └── <feature>/              one folder per feature, with its queries and tests
├── lib/
│   ├── api/                    transport, request kinds, endpoints, contracts, query keys
│   ├── auth/                   token store, refresh coordination, session provider
│   ├── config/                 validated public configuration
│   └── theme/                  light/dark preference and its pre-paint script
└── test/                       API fakes, axe helper, accessibility and design-token suites
```

## UI foundation

- **Design tokens.** Every color is a semantic token in
  [`globals.css`](src/app/globals.css), declared once as `light-dark(<light>, <dark>)` —
  the token changes with the theme, not the class.
- **Type.** IBM Plex Sans for text and IBM Plex Mono for data, self-hosted by `next/font`.
- **Themes.** Light, dark, or the system's, stored per device in `localStorage`
  (`sentinelops.theme`) and applied before first paint by a small inline script, so there
  is no flash.
- **Primitives** live in [`components/ui/`](src/components/ui). A `className` passed to
  one is for layout (margins, a grid), never to override its color or spacing — use its
  props.
- **State is never color alone.** Severity, status, and criticality each pair a distinct
  shape or icon with words.
- **Permissions decide what is offered.** Navigation items and actions are shown only to
  whoever holds the permission. That is a convenience; the API authorizes every request.

### What the tests hold you to

- [`design-tokens.test.ts`](src/test/design-tokens.test.ts) checks WCAG AA contrast for
  the token pairs the components combine — text 4.5:1, controls and marks 3:1 — in
  **both** themes. jsdom cannot measure contrast on rendered pages; this is how it is
  checked instead.
- [`accessibility.test.tsx`](src/test/accessibility.test.tsx) runs axe-core over every
  screen.
- Each feature folder has component tests that drive the pages through a faked API.

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
