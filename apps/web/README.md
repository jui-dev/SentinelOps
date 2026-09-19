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
│   │   └── orgs/[orgSlug]/   overview, members (and invitations), teams, services, incidents, settings
│   ├── invite/               invitation acceptance — outside both groups
│   └── page.tsx              `/` redirects to login, the only org, or /orgs
├── components/
│   ├── ui/                   primitives — see UI foundation below
│   ├── app/                  workspace shell, rail, situation strip, auth frame, theme control
│   ├── auth/, organizations/, invitations/, teams/, services/, incidents/
├── lib/
│   ├── config/env.ts         validated public config
│   ├── api/                  transport, the two request kinds, endpoints, contracts
│   ├── auth/                 token store, refresh coordination, session provider
│   ├── query/                the QueryClient defaults
│   └── theme/                light/dark preference and its pre-paint script
└── test/                     API fakes, axe helper, accessibility and design-token suites
```

## UI foundation

The design-system foundation for SentinelOps: an operations console, not a dashboard
template — a full-viewport workspace, rules and tables rather than cards, compact type,
and colour that means something.

It is a foundation, not the finished product. It is applied only to what exists today —
sign-in, organizations, members, invitations, teams, services, incidents, settings.
Operational screens are designed when their domain models are, and extend this system —
new navigation entries, the reserved signal colours, situation-strip levels, denser table
and record layouts — rather than being mocked up in advance. Incidents were the first:
they added an Operations navigation entry, compact operational tables, and the first use
of the signal colours. No screen shows placeholder operational data. The pieces:

| | |
| --- | --- |
| **Workspace** | `WorkspaceShell`: an ink **situation strip** across the full width, the navigation **rail** beneath it on the left, and `main` — the only thing that scrolls. Below 1024px the rail becomes a drawer (a native `<dialog>`) opened from the strip. |
| **Situation strip** | Shows where you are and the time in UTC. Its colour comes from a *level* supplied by `SituationContext`; only `neutral` exists. Incidents are recorded, but summarising them is the operational overview's job, still to come — the strip claims no state it does not summarise. |
| **Navigation** | Data, in [`components/app/navigation.ts`](src/components/app/navigation.ts). Only shipped routes are listed — Incidents, then Services, under Operations; there are no placeholders. An item may `require` a permission; like `useCan`, that is advice, and the API authorizes regardless. |
| **Pages** | `PageHeader` (eyebrow, the page's single `<h1>`, description, actions) then `PageBody`, sharing one gutter and a width: `full` for wide operational content (incidents, the overview), `list` for reference lists (members, teams, services), `form` for settings. Parts of a page are `Section`s. Hierarchy comes from surfaces, space, and type, not divider rules. |
| **Primitives** | `Button` (primary / secondary / quiet / destructive — destructive is outlined; a solid red is for high-consequence confirmations, later), `Field`, `TextArea`, `Select`, `CopyField`, `Alert` / `ErrorAlert`, `Table` (+ `THead`, `TR`, `TH`, `TD`, `TableEmpty`), `Status`, `RecordList`, `SettingRow`, `EmptyState` (a page's subject) and `EmptyNote` (an empty list within a page), `Tabs`, `IsoDate`, `LocalDateTime`, `Duration`, `Spinner`, and the shared link classes in [`ui/link.ts`](src/components/ui/link.ts) (`linkClasses` for actions, `quietLinkClasses` for an entity's name). Domain marks: `SeverityMark` and `StatusMark` ([`incidents/severity.tsx`](src/components/incidents/severity.tsx)), `CriticalityMark` ([`services/criticality-mark.tsx`](src/components/services/criticality-mark.tsx)). `Duration` and the strip's clock share one minute-aligned `useMinuteClock`, so they tick together. |
| **Tables** | One `Table` primitive, on its own quiet surface with a header surface and an edge beneath it, soft row rules, neutral row hover, and no vertical lines. `reference` (50px rows) is for configuration lists; `operational` (44px rows) is for incidents, with a sticky header, fixed column widths, and whole-row links (one tab stop per row). Lower-priority columns fold under the primary one at narrower widths rather than shrinking the type. |

### Colour tokens

Every colour is a semantic token in [`globals.css`](src/app/globals.css), declared once
as `light-dark(<light>, <dark>)`. Tailwind's default palette is **removed**, so
`bg-slate-50` does not exist, and there is no `dark:` variant — the token changes, not
the class. Four families, never mixed:

- **Neutrals** — the shell and surfaces (`rail-*`, `chrome`, `canvas`, `surface`, `thead`, `sunken`, `field`, `hover`), `fg`, `fg-muted`, `fg-subtle`, `line-*`: structure.
- **Accent** — the deep ink-indigo `accent*`, `focus`, `selected`: interaction only — primary actions, links, the current place, focus. Never large areas.
- **Feedback** — `danger-*`, `warning-*`, `success-*`, `info-*`: the outcome of what the user just did.
- **Signal** — `signal-*`: operational state. Named by intensity, not by any one model. Its first use is incident severity, in `SeverityMark` ([`components/incidents/severity.tsx`](src/components/incidents/severity.tsx)): `SEV1` critical, `SEV2` high, `SEV3` caution, `SEV4` advisory, each with its own glyph *shape* — diamond, triangle, square, ring — and always followed by the code, with the word written or read out. `nominal` also marks a resolved incident and the "no active incidents" state; `inactive` stays reserved for service health. A service's criticality is deliberately *not* a signal: it is a classification people choose, drawn by `CriticalityMark` as a neutral four-step gauge beside its word. An incident's lifecycle status is not a signal either: `StatusMark` gives each status its own outline icon beside its word — distinct shapes, not steps of progress — neutral while active, `nominal` once resolved. Severity stays the strongest signal in a row.

The visual direction is **Midnight Operations**: one hue family layered by lightness —
a navy-black navigation rail with a tonal ramp (`bg-rail`), a graphite strip, a
cool-graphite workspace, and table and panel surfaces above it — so the layers read as
depths of one material rather than regions divided by lines.

State is never colour alone: `Status` pairs a glyph whose *shape* differs by tone with
words, alerts carry a glyph and a rule, the current rail item has an edge at the rail's
side, a fill fading from it (`bg-nav-selected`), and weight.

### Type

IBM Plex Sans for text and IBM Plex Mono for data, self-hosted by `next/font`. Body copy
is 14px. Identifiers, slugs, request ids, and dates in tables use the `data` utility (mono,
tabular figures); counts use `numeric` (tabular figures in the body face). Eyebrows use
`eyebrow` and column headers are sentence case; `label-caps` (small spaced capitals) is
only for the navigation rail's group headings. Dense tables show dates
as ISO calendar dates **in UTC** (`2026-09-18`), matching the strip's clock, with the
local date and time on hover; prose uses a localized long form.

### Themes

Light, dark, or the system's, chosen in the strip and stored per device in
`localStorage` (`sentinelops.theme`). With no stored choice nothing is set and
`color-scheme` follows the OS — no JavaScript needed. An explicit choice is
`data-theme` on `<html>`, applied **before first paint** by a constant inline script
([`lib/theme/theme-script.ts`](src/lib/theme/theme-script.ts)) so there is no flash; a
future CSP can allow it by hash. `ThemeSync` re-applies it after React's development-only
Strict Mode remount, and a change in one tab reaches the others.

### What the tests hold you to

- [`design-tokens.test.ts`](src/test/design-tokens.test.ts) checks WCAG AA contrast for
  every token pair the components combine — text 4.5:1, controls and marks 3:1 — in
  **both** themes, and fails on any raw palette class or `dark:` variant in source.
  jsdom cannot measure contrast on rendered pages; this is how it is checked instead.
- [`accessibility.test.tsx`](src/test/accessibility.test.tsx) runs axe-core over every
  screen in its real frame.
- Component tests cover the Tabs keyboard model, the drawer, rail permission gating,
  and the theme mechanism.

A `className` passed to a primitive is for layout additions (margins, a grid), never to
override its colour, padding, or gap: `cx` joins classes, it does not merge them, so two
classes for one property resolve by stylesheet order. Use the primitive's props instead.

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

A member's page, `/members/[membershipId]`, ends — with `incidents:read` — with their
**Recent responses**: the incidents they started investigating, most recent first, each
with its severity, `INC-n` and title (a link), their own part — "Investigating for 2h", or
"Completed after 3h 10m" in the responder rows' accent and success marks — the service
and team, and the incident's status. **Show more** follows the API's cursor. There is
no count: it is descriptive history of a person's participation, not a measure of it.

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

## Teams

`/orgs/[orgSlug]/teams` lists the organization's teams and, for `teams:manage`, opens
a create form in place from **New team** — name and description only; the API derives the
slug. The form is inline rather than a `/teams/new` route because that route would shadow
a team whose derived slug is `new`.

The list shows each team's member and service counts.

`/teams/[teamSlug]` is the team: its name, description, and members, with an add form
(organization members not already on it) and Remove for `teams:manage`, and — for
`services:read` — the services it owns, filtered from the organization's service list.
With `incidents:read` it ends with the incidents the team is **responsible for** —
whichever service they affect — as the service page shows them (below), linking to
`/incidents?team=<slug>`.
`/teams/[teamSlug]/settings` edits the name and description and deletes the team after an
inline confirmation. While the team owns services, deletion is not offered: the section
says how many and links to them, because they must be moved first. A delete that races a
service being assigned gets the API's `409 TEAM_OWNS_SERVICES`, explained in place, and
the count is refreshed. A team that has been responsible for an incident is refused with
`409 TEAM_HAS_INCIDENTS`, and the section then says it has incident history and can only
be renamed; no incident count is loaded to know that in advance. `TeamScope` resolves the slug against the cached team list, as
`OrganizationScope` does for organizations; a slug never changes, so the URL stays valid
across renames. The slug is never displayed.

## Services

`/orgs/[orgSlug]/services` lists the organization's services — name, owner team,
criticality, description — and, for `services:manage`, opens a create form in place from
**New service**, inline for the same reason as teams. The form asks for a name, an
optional description, the owner team, and a criticality, preselected **Normal**, with the
chosen level's definition shown beneath the picker. With no teams yet, it says a service
needs an owning team and points to Teams instead.

`/services/[serviceSlug]` is the service: its name and description, its owner team (a
link), and its criticality with that level's definition, then created and updated dates,
and — when archived — when it was retired. With `incidents:read`, an **Active
incidents** row says the most severe active incident's severity and how many there are,
or none — derived from the incidents, not a health check — and an **Incidents** section
lists every active one and the five most recently resolved, in the Incidents page's
table, with **View all in Incidents** opening `/incidents?service=<slug>`. Both read the
Incidents page's own filtered lists, so the row and the section are one request, and
nothing new is cached. No health or metrics.
`/services/[serviceSlug]/settings` edits the details and criticality, moves the service to
another team, archives or unarchives it, and deletes it after an inline confirmation. A
delete refused with `409 SERVICE_HAS_INCIDENTS` is explained in place, pointing to
archiving. `ServiceScope` resolves the slug against the cached service list, as
`TeamScope` does.

Archived services are listed apart, in an **Archived** section below the services in
use, and are marked "(archived)" on their team's page and on incidents. They are not
offered when declaring an incident — and the API refuses one regardless.

Criticality renders as plain words, never with `Status` glyphs or signal colours — see
[Colour tokens](#colour-tokens).

## Incidents

`/orgs/[orgSlug]/incidents` is what is happening and what has happened: an **Active**
table — most severe first, then longest-running — and a **Resolved** table, most recent
first. Each row is the severity mark, `INC-n` and the title (a link), the service, the
responsible team, and the status and how long it has run (or when it was resolved and how
long it lasted). Both lists are the API's cursor pages, loaded with **Show more**; the page
shows no counts, which would be wrong past the first page. The table is `IncidentTable`,
shared with the service and team pages.

Above the lists, a **filter bar** — a search landmark — narrows both: **Search** (title
words, or a number such as `INC-42`, applied when submitted rather than at every
keystroke), **Severity**, **Service** (archived ones included, marked), and **Responsible
team**, with **Clear filters** while any applies. The filters live in the URL —
`?q=&severity=&service=<slug>&team=<slug>` — so a filtered list can be linked to; the
service and team are named by slug, as a reader sees them, and turned into the ids the API
takes from the cached service and team lists. The lists wait for that lookup rather than
show everything for a moment. A filter that can never apply — an unknown severity or
slug — is taken out of the URL, as an impossible period is, and everything else in the
URL is kept: clearing the filters keeps the period, and the period's **Clear** keeps the
filters. When nothing matches, each list says so and points to clearing them.

**Declare incident** opens a form in place (`incidents:manage`, which only the Admin holds):
a title, the affected service — services in use only — a severity with **nothing
preselected**, and an optional summary. Choosing the service says which team will be
responsible and the service's criticality, as context: severity is never derived from it.
The form sends no team and no status. A service archived or deleted meanwhile is
explained on the field and the service list is refreshed.

`/incidents/[incidentNumber]` fetches the incident by number — not from a list, which
is paged — with its responders, and is laid out as an incident, not a record. The header
reads at a glance: the number and how long it has been open, the title, one line of facts
— severity, status, affected service with its criticality, responsible team — and the
summary as its lead. A narrow side column holds who declared it and when, when it was
resolved, and when it last changed.

The main column is the response, then the timeline. The **responders** the API returns
are where the response stands now; the timeline is its history, and nothing is worked out
from it. What the page offers follows the caller's part:

- **The Admin** (`incidents:manage`) coordinates, from one framed **response panel** —
  the only framed element on the page. Its edge and glyph follow the state: **Awaiting
  team response**, **Response in progress** (an accent edge), **Response work complete**
  (a success edge and tint: the milestone), or resolved. Counts are three figures —
  responders, investigating, complete — and each responder is a ruled row with their
  own state and how long they have been at it. While anyone is investigating, the panel
  names who resolution is waiting for; once everyone has completed, **Resolve incident**
  sits in the panel's header, behind an inline confirmation that asks **How was it
  resolved?** — a required note, checked before anything is sent. The Admin posts updates from
  beneath the timeline without responding. **Manage incident**, in the header, opens a
  drawer from the right edge — a native `<dialog>`, like the navigation drawer — with
  severity and responsible team, where only what changed is sent, and the title and
  summary. The Admin never starts investigating or has a response of their own.
- **A member of the current responsible team** works from **Your response**, first on
  the page: **Start investigating** until they have; then that they are investigating
  and since when, the update composer inside the panel, and **Mark my response
  complete**; then that their response is complete, with no more controls. Nothing here
  resolves the incident. The team's response sits beneath it, secondary: its state in a
  line and a row per responder, without the Admin's figures or resolution.
- **A responder whose incident was reassigned** keeps their response and its controls:
  their response, not their team, governs it. Whether someone *may start* is read from
  the current team's members and the caller's membership id.
- **Anyone else** follows the incident — the response panel and the timeline — with
  nothing to do.

Each is advice for what to offer; the API decides. A start or completion answers with
the incident, which replaces the cached one, and the timeline refetches. A refusal —
resolved meanwhile, reassigned, already complete — is explained and the incident and its
team refetched, as is an update refused because the caller's response is not
investigating, or a resolution refused because someone started meanwhile.

On the timeline, a person's update is the content: their initials on the rail and their
words in a readable block with an accent rule. Everything the server recorded is a
quieter line with an icon per kind — a responder "started investigating" or "completed
their response"; the status change the first start causes reads "The incident is now
Investigating"; a reassignment reads "Reassigned the incident from Payments to Platform";
and an older entry naming a retired status (`IDENTIFIED`, `MONITORING`) is shown by its
word.

Once resolved, nothing is offered to anyone: the responders' final states and the
timeline stay readable. A **Resolution** block, with the success edge that completed
response work has, leads the page with the Admin's note — or says the incident was
resolved before notes were recorded — and the timeline's resolution entry carries the
same note beneath it. A number that cannot be one (`/incidents/INC-42`) is not-found
without a request.

Freshness is the query defaults — 30 seconds stale, refetch on focus. Nothing is pushed
or polled; live updates arrive with the realtime layer.

## Query keys

Defined in [`lib/api/query-keys.ts`](src/lib/api/query-keys.ts). Invalidate by what a
write actually changes: a rename merges the new name into `['organization', id]` and
invalidates `['me']` (whose memberships embed organization names), and leaves
`['organization', id, 'memberships']` alone. Creating or revoking an invitation
invalidates only `['organization', id, 'invitations']`; accepting one refetches `['me']`.
Team pages read the team from `['organization', id, 'teams']`, so every team change —
including adding or removing a member, which changes the count — refreshes it; member
changes also refresh `['organization', id, 'teams', teamId, 'members']`.
Service pages read the service from `['organization', id, 'services']`. Creating,
changing, or deleting a service refreshes it and the team list (each team's service
count); renaming a team refreshes it too, because every service embeds its owner's name.
Incidents live under `['organization', id, 'incidents']`: the two paged lists at
`[…, 'list', 'active' | 'resolved', range, filters]` — each range and set of filters its
own query, the filters only those in use — each incident at `[…, 'detail', number]`, and
each member's responses at `[…, 'member-responses', membershipId]`, which a start or a
completion stales.
Declaring or changing an incident writes the API's answer into its detail entry and
refreshes both lists — a status, severity, or team change can move it between or within
them. Changing a service (its name, criticality, or archival) or renaming a team
refreshes the whole incidents prefix, because every incident embeds them.
No query key ever contains an invitation token.
