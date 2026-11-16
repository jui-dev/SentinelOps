# Security

How SentinelOps decides who someone is, which organization they are acting in, and what
they may do there — and what it does not protect against yet.

- [Authentication](#authentication)
- [Passwords](#passwords)
- [Sign-in limits](#sign-in-limits)
- [Tenancy](#tenancy)
- [Roles and permissions](#roles-and-permissions)
- [Members](#members)
- [Responses, headers, and logs](#responses-headers-and-logs)
- [Known gaps](#known-gaps)

## Authentication

Every API route requires authentication **by default**: `JwtAuthGuard` is registered
globally, so a new endpoint is closed unless it is deliberately marked `@Public()` — a
visible line in any review. Only the routes that start or end a session are public.

### Two tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Form | JWT, HS256 | 32 random bytes |
| Lifetime | 15 minutes | 30 days |
| Travels in | The response body, then `Authorization: Bearer` | An `HttpOnly` cookie |
| Stored on the server | Nowhere | Only as a SHA-256 hash |

The access token carries **identity only** — user id, issuer, and times. No organization
and no role: those are looked up on every request, so removing someone or changing their
role takes effect on their very next request, not when a token expires.

The refresh cookie is `HttpOnly`, `SameSite=Lax`, `Secure` outside development, and
scoped to `/api/v1/auth`, so it never travels with ordinary API calls. `SameSite=Lax` and
a `POST`-only refresh route are the CSRF defence: a browser does not attach the cookie to
a cross-site `POST`.

### Rotation and reuse detection

Every refresh revokes the token it was given and issues a successor in the same
**family** — every token descended from one sign-in.

| Presented refresh token | Result |
| --- | --- |
| Valid | A new access token and a rotated cookie |
| Unknown or expired | `401` |
| **Already used** | **The whole family is revoked**, then `401 REFRESH_TOKEN_REUSED` |

A used token is kept, revoked, until it expires, precisely so a replay can be recognized.
If a stolen refresh token is used after the real client has rotated past it — or the
other way round — both are signed out, rather than leaving the thief working. The
person's other sessions are unaffected.

## Passwords

- **Argon2id** at OWASP's recommended settings (19 MiB, two passes, one lane). Parameters
  live in each stored hash, so raising them later invalidates nothing.
- **Length, not composition:** 12 to 128 characters, following NIST SP 800-63B.
- **One answer for every failed sign-in.** An unknown email, a deleted account, and a
  wrong password all get the same `401`, and an unknown email is still checked against a
  dummy hash so timing gives nothing away.
- **One-time passwords.** A person added by an Admin signs in with a one-time password and
  can do nothing but choose their own until they have. This is checked in the database on
  every request, not carried in a token.
- **Changing a password** requires the current one, even when signed in, and ends every
  other session.

## Sign-in limits

Password guessing is limited ([`attempt-limiter.ts`](../apps/api/src/auth/attempt-limiter.ts)):

| Limit | Allowed failures | Window |
| --- | --- | --- |
| Per email address | 5 | 15 minutes |
| Per client address | 50 (across every email — an office may share one address) | 15 minutes |
| Wrong current password, when changing it | 5 | 15 minutes |

Past a limit the API answers `429 TOO_MANY_ATTEMPTS` with a `Retry-After` header, and does
not check the password at all — so a correct guess cannot slip through. An email address
is counted whether or not an account has it, so a block reveals nothing. A correct
password clears its address's count. Blocks are recorded in the activity log.

**Behind a proxy.** The per-client limit keys on the client's address. Behind a load
balancer or CDN, every request arrives from the proxy, so set `TRUST_PROXY_HOPS` to the
number of proxies in front of the API; the client address is then read that many entries
back in `X-Forwarded-For`. The setting is a count rather than "trust the header", because
trusting the whole header would let any client name its own address and step around the
limit.

The counts live in the API's memory, which is right for one instance. Running several
would need them in a shared store; that change is confined to `attempt-limiter.ts`.

## Tenancy

A user is global; everything else belongs to an organization. A request names its
organization in the path — `/api/v1/organizations/:organizationId/…` — and nowhere else.
Three independent checks keep it there:

| | Admission | Authorization | Resource isolation |
| --- | --- | --- | --- |
| Asks | Is the caller a current member of this organization? | May their role do this? | Does *this row* belong to this organization? |
| Where | `OrganizationMembershipGuard` | `OrganizationPermissionGuard` | Every query, in the service |
| Fails with | `404` | `403 PERMISSION_DENIED` | `404` for that resource |

- **Not a member looks like not found.** An organization that does not exist, was
  deleted, or is someone else's all answer the same `404`.
- **`403` only after admission**, so it tells a member nothing they did not already know.
- **Every query is scoped.** A lookup puts `organizationId` in its `where` clause next to
  the resource id; nothing fetches by id and checks the organization afterwards. Services
  take `organizationId` as an argument rather than reading it from the request, and the
  integration suite calls them with no guards at all to prove they isolate on their own.
- **The database backs it up.** Links between tenant-owned rows use composite foreign keys
  that include `organization_id`, so a team member, service owner, or incident from another
  organization cannot be stored even by raw SQL — see
  [data-model.md](data-model.md#keeping-tenants-apart).
- **Wiring mistakes fail closed.** Organization routes are declared with
  `@OrganizationController()`, and an architecture test fails if the route parameter
  appears anywhere else. A handler without a declared permission is refused with a masked
  `500` before it runs.

## Roles and permissions

Each person holds one role per organization. Routes name a **permission**, never a role;
which roles hold which permission is written out once, in
[`role-permissions.ts`](../apps/api/src/authorization/role-permissions.ts).

| Permission | Admin | Incident Manager | Reporter | Responder |
| --- | :---: | :---: | :---: | :---: |
| `organization:read` | ✓ | ✓ | ✓ | ✓ |
| `organization:update` | ✓ | | | |
| `activity:read` | ✓ | | | |
| `memberships:read` | ✓ | ✓ | ✓ | ✓ |
| `memberships:read-all` | ✓ | ✓ | | |
| `members:manage` | ✓ | | | |
| `invitations:read` | ✓ | | | |
| `invitations:manage` | ✓ | | | |
| `teams:read` | ✓ | ✓ | ✓ | ✓ |
| `teams:read-all` | ✓ | ✓ | | |
| `teams:manage` | ✓ | | | |
| `services:read` | ✓ | ✓ | ✓ | ✓ |
| `services:manage` | ✓ | | | |
| `incidents:read` | ✓ | ✓ | ✓ | ✓ |
| `incidents:read-all` | ✓ | ✓ | | |
| `incidents:declare` | ✓ | ✓ | ✓ | |
| `incidents:manage` | ✓ | ✓ | | |
| `incidents:respond` | ✓ | ✓ | ✓ | ✓ |
| `responses:work` | | | | ✓ |
| `incident-analyses:write` | ✓ | ✓ | | ✓ |
| `notifications:read` | ✓ | ✓ | ✓ | ✓ |

Some rules depend on the incident, not just the role, and are enforced in the service:

- **Responding** (`responses:work`) reaches only incidents open to the responder's team or
  assigned to them by name.
- **Posting updates** (`incidents:respond`) is open to whoever decides on incidents, to the
  person who declared it, and to a responder while their own response is under way.
- **Seeing incidents.** Without `incidents:read-all`, a member sees their teams' incidents
  and the ones they declared, responded to, were assigned to, or own the analysis of.

The API reports the caller's permissions with the organization, read from the same table
the guards use, so what the web app offers and what the API allows cannot drift apart.

## Members

- **Added by an Admin**, with a one-time password. An email that already has an account —
  in any organization — is refused, so one organization cannot pull in someone else's
  account.
- **The last Admin** cannot be demoted or removed, and those changes lock the Admins' rows
  first so two of them racing cannot remove the last two.
- **Removal is soft.** Access ends with the person's next request, because admission
  refuses a removed membership; their past responses, updates, and analyses stay under
  their name. Removal is
  refused while they still have a response under way or an unpublished analysis, so
  nothing is left with nobody to finish it. An Admin can restore them.
- **Password resets** are done by an Admin, who sets a new one-time password; the member's
  sessions end.

## Responses, headers, and logs

- **No persistence internals in responses.** Every response is built by a mapper that names
  its fields; queries `select` only what they need, and the password hash is read in
  exactly one place. An integration test walks every response body and fails on any hash,
  token, or internal column.
- **API headers.** Every response carries `X-Content-Type-Options: nosniff`, a
  Content-Security-Policy that allows nothing (the API only returns JSON),
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
  `Strict-Transport-Security`, and `Cross-Origin-Opener-Policy: same-origin`, without
  `X-Powered-By`.
- **Web headers.** The web app sends `X-Content-Type-Options`, `Referrer-Policy`, and
  `X-Frame-Options: DENY`.
- **Logs** never contain request or response bodies, headers, or user-written text, and
  secret-looking keys are redacted — see [architecture.md](architecture.md#logging).
- **Public sign-up is off** unless the operator switches it on.

## Known gaps

- **No email.** There is no email verification or self-service password reset; an Admin
  resets passwords.
- **In-memory sign-in limits** — correct for one API instance only.
- **No Content-Security-Policy on the web app** yet; a nonce-based policy is future work.
- **Expired refresh tokens are not cleaned up.** They are refused when used; deleting them
  needs a scheduled job.
- **No multi-factor authentication or single sign-on.**
- **Row-level security** is not enabled in PostgreSQL; isolation is enforced by scoped
  queries and composite keys, and proven by the integration tests.
