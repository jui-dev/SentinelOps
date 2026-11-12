/**
 * The wire contract for the activity log.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

export type ActivityArea =
  | 'PEOPLE'
  | 'TEAMS'
  | 'SERVICES'
  | 'KNOWN_ISSUES'
  | 'ORGANIZATION'
  | 'SECURITY';

export type ActivityAction =
  | 'MEMBER_ADDED'
  | 'ROLE_CHANGED'
  | 'PASSWORD_RESET'
  | 'INVITATION_SENT'
  | 'INVITATION_REVOKED'
  | 'INVITATION_ACCEPTED'
  | 'TEAM_CREATED'
  | 'TEAM_UPDATED'
  | 'TEAM_DELETED'
  | 'TEAM_MEMBER_ADDED'
  | 'TEAM_MEMBER_REMOVED'
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_DELETED'
  | 'KNOWN_ISSUE_CREATED'
  | 'KNOWN_ISSUE_UPDATED'
  | 'KNOWN_ISSUE_MERGED'
  | 'ORGANIZATION_UPDATED'
  | 'SIGNED_IN'
  | 'SIGN_IN_FAILED'
  | 'SIGN_IN_BLOCKED'
  | 'PASSWORD_CHANGED';

export type ActivitySubjectType =
  | 'MEMBERSHIP'
  | 'INVITATION'
  | 'TEAM'
  | 'SERVICE'
  | 'KNOWN_ISSUE'
  | 'ORGANIZATION';

/**
 * One field an entry changed. Values are as they were at the time — a role
 * as its enum value, a name as it was spelled — and null for a side that did
 * not exist: a field set when something was made has no before.
 */
export interface ActivityChange {
  field: string;
  before: string | null;
  after: string | null;
}

/**
 * One entry in the log. `reference` is a short code to point at it by;
 * `client` says where it came from, when it was written during a request.
 * `browser` is the User-Agent described for a person ("Chrome on Windows"),
 * or null when it names no browser anyone would recognise.
 *
 * `repeat` is set on a row that stands for several: wrong passwords tried
 * one after another on one account, folded into the latest. `count` is how
 * many, `firstAt` when the first was. Null on every other row.
 */
export interface ActivityEntryResponse {
  id: string;
  reference: string;
  action: ActivityAction;
  area: ActivityArea;
  occurredAt: string;
  actor: { id: string; name: string };
  subject: { type: ActivitySubjectType; id: string; name: string } | null;
  changes: ActivityChange[];
  client: { ipAddress: string | null; browser: string | null } | null;
  repeat: { count: number; firstAt: string } | null;
}

/**
 * A page of the log, newest first. `nextCursor` fetches the older ones, and
 * is null on the last page. `areaCounts` — on the Changes view only — counts
 * every area under the same person, search and period, ignoring the area
 * filter, so each area's button can say how many it would show.
 *
 * `securityTotals` — on the Security view only — counts sign-ins, wrong
 * passwords and blocks under the same filters, each attempt counted rather
 * than folded.
 */
export interface ActivityPageResponse {
  entries: ActivityEntryResponse[];
  nextCursor: string | null;
  areaCounts: Record<Exclude<ActivityArea, 'SECURITY'>, number> | null;
  securityTotals: {
    signIns: number;
    failedSignIns: number;
    blocked: number;
  } | null;
}

/**
 * One entry in full: the entry, the most recent earlier entries about the
 * same subject, and whether that subject still exists — with its slug where
 * its page is addressed by one — so the log can link to it.
 *
 * For a sign-in event, three more, null on any other entry:
 *   attempts     for a wrong password, each of the run it ends — the wrong
 *                passwords tried one after another — oldest first.
 *   next         what happened to the account after it: the block, the
 *                sign-in that worked. Null when nothing has yet.
 *   usualClient  where the account most often signed in from in the 30
 *                days before, so a new address or browser stands out.
 */
export interface ActivityEntryDetailResponse extends ActivityEntryResponse {
  history: ActivityEntryResponse[];
  subjectNow: { exists: boolean; slug: string | null } | null;
  attempts: string[] | null;
  next: ActivityEntryResponse | null;
  usualClient: { ipAddress: string | null; browser: string | null } | null;
}
