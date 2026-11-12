/**
 * TEMPORARY — the story the demo history tells: about 26 weeks of AcmePay's
 * incidents, hand-shaped rather than random. buildDemoHistory turns it into
 * incidents, responses, and timelines; everything here is plain data.
 *
 * Weeks are the 26 seven-day stretches before the anchor, numbered 1
 * (oldest) to 26 (the one ending at the anchor). An arc's day is a weekday,
 * 0 (Monday) to 6 (Sunday), UTC, within its week.
 *
 * The shape of it:
 *
 *   W1–W5    a steady baseline across all three services
 *   W6–W8    Payments' card-network migration: a SEV1 and its aftermath
 *   W11      Authentication's signing-key rotation SEV1, worked by Lee alone
 *   W12–W13  a holiday lull
 *   W16–W18  Risk's fraud-model rollout, with Sam and Jordan busiest
 *   W22      a database failover touching two services at once
 *   now      five active incidents in different states (ACTIVE)
 *
 * Who does what follows the roles: Alex, the Reporter, raises a share of the
 * incidents and Ava, the Incident Manager, confirms his suggested severity;
 * Ava decides on every incident — its severity, its resolution, the status
 * page — except while she is away over the holiday lull, when the Admin
 * steps in. The Responders work them.
 *
 * Personas are named by email, as in dev-account.ts.
 */
import type { DevTeam } from '../dev-account.js';

export type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export type DemoService = 'Payment API' | 'Authentication' | 'Fraud Detection';

export const ADMIN = 'admin@example.com';
export const MANAGER = 'ava@example.com';
export const REPORTER = 'alex@example.com';
export const PRIYA = 'priya@example.com';
export const SAM = 'sam@example.com';
export const LEE = 'lee@example.com';
export const JORDAN = 'jordan@example.com';

/** Who is on each team, as dev-account.ts places them. */
export const TEAM_MEMBERS: Record<DevTeam, readonly string[]> = {
  Payments: [PRIYA, SAM],
  Platform: [LEE],
  Risk: [SAM, JORDAN],
};

export const SERVICE_TEAM: Record<DemoService, DevTeam> = {
  'Payment API': 'Payments',
  Authentication: 'Platform',
  'Fraud Detection': 'Risk',
};

/** Weeks each persona was away, inclusive: they started no responses. */
export const AWAY: Record<string, readonly [number, number]> = {
  [MANAGER]: [12, 13],
  [JORDAN]: [4, 5],
  [SAM]: [9, 9],
  [PRIYA]: [13, 14],
  [LEE]: [19, 20],
};

/** How often the Reporter raises an incident rather than whoever decides. */
export const REPORTED_SHARE = 0.4;

/**
 * How readily each persona picks an incident up first, relative to the norm.
 * Sam's time is split between two teams, so on either he is less often first.
 */
export const PICKUP: Record<string, number> = {
  [SAM]: 0.5,
};

/** How much each persona writes while responding, relative to the norm. */
export const VOICE: Record<string, number> = {
  [PRIYA]: 1.3,
  [SAM]: 1,
  [LEE]: 1.2,
  [JORDAN]: 0.6,
};

/**
 * Everyday incidents per week and service, beyond the ARCS: [Payment API,
 * Authentication, Fraud Detection]. Platform has none while Lee is away,
 * since nobody else could have responded.
 */
export const WEEKLY_LOAD: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], // W1
  [1, 0, 1],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1], // W5
  [1, 0, 1], // W6  migration begins
  [1, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 1, 0], // W10
  [1, 0, 1], // W11 key rotation
  [0, 0, 1], // W12 lull
  [1, 0, 0], // W13 lull
  [1, 1, 1],
  [1, 1, 1], // W15
  [1, 0, 1], // W16 model rollout
  [1, 1, 1],
  [1, 0, 1],
  [1, 0, 1], // W19 Lee away
  [1, 0, 1], // W20 Lee away
  [1, 1, 1],
  [1, 1, 1], // W22 failover
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1], // W25
  [1, 0, 1], // W26 only what is settled before the anchor
];

export interface Scenario {
  title: string;
  summary: string;
  /** Severities it plausibly carries; the first is the likelier. */
  severities: readonly Severity[];
  /** Responders' updates, in the order an investigation reads. */
  updates: readonly string[];
  /** How it ended, in the Admin's words. */
  resolution: string;
}

/** Everyday incidents, each used at most twice (the second a recurrence). */
export const SCENARIOS: Record<DemoService, readonly Scenario[]> = {
  'Payment API': [
    {
      title: 'Partial refunds returning 500',
      summary:
        'Partial refunds on multi-capture charges fail with an internal error. Full refunds are unaffected.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Reproduced with a two-capture charge; full refunds still work.',
        'Refund amount validation rejects the remaining balance after the first capture.',
        'Fix deployed to canary; partial refunds succeeding there.',
      ],
      resolution:
        'Corrected the remaining-balance calculation for multi-capture charges and replayed the 41 failed refunds. Follow-up: add multi-capture cases to the refund contract tests.',
    },
    {
      title: 'Merchant webhook deliveries delayed',
      summary:
        'Webhook events are reaching merchants 10–25 minutes late. Payments themselves are processing normally.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'Delivery queue depth is climbing; workers are healthy but slow.',
        'One merchant endpoint is timing out and holding worker slots for 30 s each.',
        'Lowered the per-endpoint timeout; queue is draining.',
        'Backlog cleared, delivery lag back under 5 seconds.',
      ],
      resolution:
        'A single slow merchant endpoint was exhausting delivery workers. Per-endpoint timeouts now isolate slow receivers; the backlog drained within 20 minutes.',
    },
    {
      title: 'Elevated latency on charge creation',
      summary:
        'p95 latency on POST /v1/charges is around 1.8 s against a normal 400 ms.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Latency is in the database span, not the processor call.',
        'A missing index on the new merchant_settings join is causing sequential scans.',
        'Index built concurrently; p95 dropping.',
      ],
      resolution:
        'Added the missing merchant_settings index that the last release needed. p95 back to 380 ms. Follow-up: run the query-plan check in CI for migrations touching hot tables.',
    },
    {
      title: 'Idempotency keys expiring early',
      summary:
        'Retried requests within the 24-hour window are being treated as new, creating duplicate charge attempts.',
      severities: ['SEV3'],
      updates: [
        'Keys are being evicted after about 6 hours instead of 24.',
        'The cache cluster hit its memory limit and is evicting by LRU.',
        'Scaled the cache and moved idempotency keys to a dedicated keyspace with no eviction.',
      ],
      resolution:
        'Cache eviction under memory pressure dropped idempotency keys early. They now live in a non-evicting keyspace; the 12 duplicate attempts were all declined by the processor, so no customer was double-charged.',
    },
    {
      title: 'Stale currency conversion rates',
      summary:
        'Multi-currency charges are using exchange rates that have not refreshed since 06:00 UTC.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'The rates import job is failing authentication with the rates provider.',
        'Provider rotated our API credential; the new one was never loaded.',
      ],
      resolution:
        'Loaded the rotated rates-provider credential and re-ran the import. Rates are current again. Follow-up: alert when rates are more than an hour old.',
    },
    {
      title: 'Merchant payout batch delayed',
      summary:
        "Today's payout batch has not been sent to the bank. Merchants may see payouts arrive a day late.",
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Batch generation finished, but the file transfer to the bank is stuck.',
        'The bank rejected the connection: our SFTP key was due for renewal.',
        'Renewed key accepted; batch transferred.',
        'Bank confirmed receipt; payouts will settle on the usual schedule.',
      ],
      resolution:
        'The payout file transfer failed on an expired SFTP key. Renewed it and resent the batch before the bank cut-off, so payouts were not delayed. Follow-up: track key expiry alongside certificates.',
    },
    {
      title: 'Apple Pay token decryption failures',
      summary: 'About 4% of Apple Pay charges fail with a decryption error.',
      severities: ['SEV3'],
      updates: [
        'Failures all use the payment processing certificate issued last month.',
        'One API node is still running with the previous certificate bundle.',
        'Node recycled with the current bundle; failures stopped.',
      ],
      resolution:
        'One node missed the certificate bundle rollout and could not decrypt tokens made with the new certificate. Recycled it; rollouts now verify the bundle version on every node.',
    },
    {
      title: 'Connection pool exhaustion on payments database replicas',
      summary:
        'Read endpoints are intermittently timing out waiting for a database connection.',
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Replica connection pools are saturated; primary is fine.',
        'A reporting query from the merchant dashboard is holding connections for minutes.',
        'Moved the reporting query to the analytics replica.',
        'Pool usage back under 40%.',
      ],
      resolution:
        'A long-running merchant report was pinning replica connections. It now runs on the analytics replica with its own pool and a statement timeout.',
    },
    {
      title: 'Dashboard showing pending payments as failed',
      summary:
        'The merchant dashboard labels pending bank-transfer payments as failed. The API reports them correctly.',
      severities: ['SEV4', 'SEV3'],
      updates: [
        'Only the dashboard status badge is wrong; API responses are correct.',
        'The new status mapping is missing the pending_transfer state.',
      ],
      resolution:
        'Added the missing pending_transfer mapping to the dashboard. No payment state was ever wrong, only its label.',
    },
    {
      title: 'Rate limiter rejecting merchant burst traffic',
      summary:
        'A large merchant running a flash sale is receiving 429s on charge creation.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Their traffic is 6× normal and within their contracted limit.',
        'The limiter is still using the default tier; the merchant upgrade was never applied.',
        'Applied their contracted tier; 429s stopped.',
      ],
      resolution:
        "The merchant's contracted rate-limit tier was never applied after their plan change. Applied it and audited the other 14 upgraded merchants; two more corrected.",
    },
    {
      title: 'Receipt emails not sent for successful charges',
      summary:
        'Customers are not receiving receipts. Charges succeed normally.',
      severities: ['SEV4'],
      updates: [
        'Email provider is rejecting sends with a template error.',
        'Last deploy renamed a template variable the receipt template still uses.',
      ],
      resolution:
        'A renamed template variable broke receipt rendering. Fixed the template and resent the 1,200 missed receipts.',
    },
    {
      title: 'SEPA mandate creation failing',
      summary:
        'New SEPA Direct Debit mandates are rejected with a validation error.',
      severities: ['SEV3'],
      updates: [
        'Rejections are for IBANs from two countries only.',
        'Our IBAN validation library update changed length rules for those countries.',
        'Pinned the previous library version; mandates succeeding.',
      ],
      resolution:
        'An IBAN validation library update applied the wrong length rules for two countries. Pinned the previous version and reported the bug upstream.',
    },
    {
      title: 'Card BIN lookup returning stale issuer data',
      summary:
        'Some newly issued cards are shown with the wrong issuing bank and card type.',
      severities: ['SEV4', 'SEV3'],
      updates: [
        "The BIN table hasn't refreshed in nine days.",
        'The weekly refresh job was paused during the last maintenance window and never resumed.',
      ],
      resolution:
        'Resumed the paused BIN table refresh and ran it by hand. Follow-up: alert when the BIN table is more than eight days old.',
    },
    {
      title: 'Chargeback notifications missing from dispute feed',
      summary: 'New disputes are not appearing in the merchant dispute feed.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'The acquirer changed the dispute file format overnight.',
        'Parser updated for the new format; reprocessing the last two files.',
      ],
      resolution:
        "Updated the dispute file parser for the acquirer's new format and reprocessed the missed files; 37 disputes backfilled with their original dates.",
    },
    {
      title: 'Payment links expiring immediately',
      summary:
        'Newly created payment links show as expired when customers open them.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Links created with a custom expiry store it in seconds, read back as milliseconds.',
        'Fix deployed; re-extending the links created today.',
      ],
      resolution:
        'A unit mismatch stored custom link expiries a thousand times too short. Fixed the conversion and re-extended the 380 affected links.',
    },
    {
      title: 'Bank transfer reconciliation mismatch',
      summary:
        "Yesterday's incoming bank transfers do not reconcile against the bank statement.",
      severities: ['SEV3'],
      updates: [
        'The difference is exactly the transfers received after 23:00 UTC.',
        "The bank's statement cut-off moved to 23:00; our window still assumes midnight.",
      ],
      resolution:
        "Aligned the reconciliation window with the bank's new 23:00 cut-off and re-ran it. Every transfer reconciled; nothing was missing.",
    },
    {
      title: 'Checkout SDK failing to load on Safari',
      summary:
        'The embedded checkout does not render for Safari users on some merchant sites.',
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Safari blocks the SDK frame because of a changed Content-Security-Policy header.',
        "The header change shipped with yesterday's CDN configuration.",
        'Header restored; checkout renders on Safari again.',
      ],
      resolution:
        'A CDN configuration change narrowed our frame-ancestors policy, which Safari enforced strictly. Restored the header and added a Safari check to the SDK smoke tests.',
    },
    {
      title: 'Subscription renewals charged twice',
      summary:
        "Some customers were charged twice for this month's subscription renewal.",
      severities: ['SEV2'],
      updates: [
        'The renewal job ran twice after a scheduler failover.',
        'Paused renewals; identifying the duplicate charges.',
        'Refunds issued for every duplicate.',
      ],
      resolution:
        'A scheduler failover ran the renewal job twice. Refunded all 212 duplicates the same day; the job now takes a per-period lock before charging.',
    },
    {
      title: 'Tax calculation timing out',
      summary:
        'Checkout is falling back to estimated tax because the tax service is timing out.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Tax provider latency is up for addresses in one region.',
        'Provider has acknowledged and is scaling their regional cluster.',
      ],
      resolution:
        "The tax provider's regional cluster was overloaded; our fallback to estimated tax worked as designed. Estimated orders were recalculated after recovery.",
    },
  ],
  Authentication: [
    {
      title: 'Password reset emails delayed',
      summary:
        'Password reset emails are arriving 15–40 minutes after the request.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Our email provider shows a sending backlog on the shared IP pool.',
        'Switched transactional auth mail to the dedicated IP pool.',
        'Delivery time back under a minute.',
      ],
      resolution:
        'Auth emails were queued behind marketing volume on a shared sending pool. They now always use the dedicated transactional pool.',
    },
    {
      title: 'SSO logins failing for one enterprise tenant',
      summary:
        'Users at one enterprise customer cannot sign in through SAML SSO.',
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Assertions from their identity provider fail signature validation.',
        'Their IdP signing certificate was rotated; we still trust the old one.',
        'Customer sent the new certificate metadata; importing it.',
        'Logins succeeding for the tenant.',
      ],
      resolution:
        "The customer rotated their IdP certificate without notice. Imported the new metadata. Follow-up: poll tenants' metadata URLs so rotations are picked up automatically.",
    },
    {
      title: 'MFA codes delayed for UK phone numbers',
      summary:
        'SMS one-time codes to UK numbers take several minutes to arrive.',
      severities: ['SEV3'],
      updates: [
        'Delays are only on one SMS carrier route.',
        'Failed the UK route over to the secondary SMS provider.',
      ],
      resolution:
        'A carrier route degradation at our SMS provider delayed UK codes. Traffic moved to the secondary provider until they confirmed the fix.',
    },
    {
      title: 'Session refresh intermittently returning 401',
      summary: 'Some signed-in users are being logged out unexpectedly.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'Failures correlate with requests landing on two specific nodes.',
        'Those nodes have a clock drift of about 90 seconds.',
        'NTP restarted on both; drift corrected.',
      ],
      resolution:
        'Clock drift on two nodes made fresh tokens look not-yet-valid. Fixed time sync and added a drift alert.',
    },
    {
      title: 'Login page slow to load',
      summary: 'The login page takes 6–10 seconds to render for some regions.',
      severities: ['SEV4', 'SEV3'],
      updates: [
        'Static assets are being served from origin, bypassing the CDN.',
        'A cache rule change last night excluded the new asset path.',
      ],
      resolution:
        'Restored the CDN cache rule for the login asset path. Load time back under a second everywhere.',
    },
    {
      title: 'Account lockouts triggering too aggressively',
      summary:
        'Users are being locked out after one or two failed attempts instead of five.',
      severities: ['SEV3'],
      updates: [
        'Each failed attempt is being counted twice.',
        'The new audit hook also increments the failure counter.',
        'Hotfix deployed; unlocking affected accounts.',
      ],
      resolution:
        'A new audit hook double-counted failed sign-ins. Removed the duplicate increment and unlocked the 230 affected accounts.',
    },
    {
      title: 'OAuth consent screen failing for a partner app',
      summary:
        'One partner integration cannot complete the OAuth consent flow.',
      severities: ['SEV4'],
      updates: ["The partner's redirect URI changed and is not registered."],
      resolution:
        "Registered the partner's new redirect URI after verifying the change with them.",
    },
    {
      title: 'Sign-in audit log lagging',
      summary:
        'Sign-in events are appearing in the audit log about an hour late.',
      severities: ['SEV4'],
      updates: [
        'The audit consumer is running with one partition assigned instead of six.',
        'Consumer restarted; partitions rebalanced and lag falling.',
      ],
      resolution:
        'A stuck consumer rebalance left the audit consumer on one partition. Restarted it; the log caught up in 25 minutes with nothing lost.',
    },
    {
      title: 'Magic-link emails landing in spam',
      summary: 'Several mail providers are filing sign-in links as spam.',
      severities: ['SEV4'],
      updates: [
        'Our DKIM key for the auth subdomain is not being published.',
        'DNS record restored; new sends are passing DKIM.',
      ],
      resolution:
        'A DNS cleanup removed the DKIM record for the auth mail subdomain. Restored it; deliverability recovered within a day.',
    },
    {
      title: 'API key validation slow after cache flush',
      summary:
        'API requests are 300–500 ms slower while keys are validated against the database.',
      severities: ['SEV3'],
      updates: [
        'A deploy flushed the key cache and every request is a cache miss.',
        'Cache warming; latency falling.',
      ],
      resolution:
        'A deploy flushed the API key cache and the database absorbed every lookup. Deploys now keep the cache and warm the most-used keys first.',
    },
    {
      title: 'New-device verification loop on Android',
      summary:
        'Some Android users are asked to verify their device on every sign-in.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'The app generates a new device identifier after each update on some Android versions.',
      ],
      resolution:
        'An Android storage change reset the device identifier on app update. Moved it to the keystore; the next app release carries the fix.',
    },
    {
      title: 'Admin console sessions expiring early',
      summary: 'Internal admin console sessions end after about 5 minutes.',
      severities: ['SEV4'],
      updates: [
        'Session lifetime for the console is configured in minutes but read as hours.',
      ],
      resolution:
        'Corrected the admin console session lifetime, which was configured in the wrong unit.',
    },
  ],
  'Fraud Detection': [
    {
      title: 'Velocity rules not applied to new merchants',
      summary:
        'Merchants onboarded this week are not covered by transaction velocity rules.',
      severities: ['SEV3'],
      updates: [
        "New merchants aren't in the rule engine's merchant segment.",
        'The segment refresh job has been failing since Monday.',
        'Refresh fixed and re-run; new merchants now covered.',
      ],
      resolution:
        'A failing segment refresh left new merchants outside velocity rules. Fixed the job and reviewed the uncovered transactions; nothing suspicious found.',
    },
    {
      title: 'Device fingerprinting timing out',
      summary:
        'Risk scoring is falling back to scores without device signals for about 30% of requests.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'The fingerprinting vendor is responding in 2–4 s against our 800 ms budget.',
        'Vendor confirmed a regional degradation.',
        'Vendor latency recovering; fallback rate under 5%.',
      ],
      resolution:
        "The device-fingerprinting vendor had a regional outage. Our fallback worked as designed. Follow-up: tighten the fallback score's thresholds while device signals are missing.",
    },
    {
      title: 'Chargeback feedback ingestion stalled',
      summary:
        'Confirmed fraud labels from chargebacks have not reached the feature store for two days.',
      severities: ['SEV4', 'SEV3'],
      updates: [
        'The ingestion job fails on a malformed reason code.',
        'Added handling for the new reason code; backfilling.',
      ],
      resolution:
        'A new chargeback reason code broke label ingestion. Handled it and backfilled two days of labels.',
    },
    {
      title: 'False declines elevated for a travel merchant',
      summary:
        'A large travel merchant reports a spike in legitimate bookings being declined.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'Declines are driven by the cross-border rule on last-minute bookings.',
        'Seasonal booking pattern is tripping the rule; added a merchant-specific override.',
        'Decline rate back to their normal 1.2%.',
      ],
      resolution:
        "Seasonal last-minute bookings were tripping the cross-border rule. Added a reviewed override for the merchant's category. Follow-up: seasonality features in the next model.",
    },
    {
      title: 'Card network blocklist sync delayed',
      summary: 'The latest card-network blocklist has not been applied.',
      severities: ['SEV3', 'SEV4'],
      updates: [
        'Download succeeded; the apply step is failing on a duplicate key.',
        'The network published duplicate entries; deduplicating before apply.',
      ],
      resolution:
        "Duplicate entries in the network's blocklist broke our apply step. It now deduplicates, and the list was applied 3 hours late.",
    },
    {
      title: 'Risk score missing on some transactions',
      summary:
        'About 2% of transactions are being processed without a risk score.',
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Missing scores are all from the new EU region.',
        'The EU scoring deployment is missing a feature-store credential.',
        'Credential added; scores present for new transactions.',
        'Rescoring the unscored transactions for review.',
      ],
      resolution:
        'The new EU scoring deployment could not reach the feature store and fell through unscored. Fixed the credential, rescored the affected transactions, and made a missing score fail closed.',
    },
    {
      title: 'Case management alerts failing to load',
      summary: 'Fraud analysts cannot open alerts in the case management tool.',
      severities: ['SEV4'],
      updates: [
        'The alerts page errors on cases with more than 500 linked transactions.',
      ],
      resolution:
        'Paginated linked transactions on the alert page. Analysts can open every case again.',
    },
    {
      title: 'Rule deployed with an inverted threshold',
      summary:
        'A new high-value rule is flagging low-value transactions instead of high-value ones.',
      severities: ['SEV2', 'SEV3'],
      updates: [
        'Review queue grew by 3,000 cases in an hour.',
        'The rule compares amount < threshold instead of >.',
        'Rule rolled back; clearing the wrongly queued cases.',
      ],
      resolution:
        'A rule shipped with an inverted comparison. Rolled it back and bulk-released the wrongly queued cases. Follow-up: rules must pass a shadow-mode run before going live.',
    },
    {
      title: 'Feature store lagging on customer history',
      summary: 'Customer history features are about 45 minutes stale.',
      severities: ['SEV3'],
      updates: [
        'Stream processor consumer lag is growing.',
        'A hot partition from one large merchant is slowing the processor.',
        'Added partitions and rebalanced; lag recovering.',
      ],
      resolution:
        "One merchant's volume created a hot partition. Repartitioned the history stream; lag back under 30 seconds.",
    },
    {
      title: 'Sanctions screening API rate-limited',
      summary: 'Sanctions screening calls are being throttled by the provider.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'Retries are amplifying traffic to the provider.',
        'Added backoff with jitter and cached recent negative results.',
      ],
      resolution:
        "Unbounded retries tripped the screening provider's rate limit. Added backoff and a short-lived cache of negative results; call volume down 60%.",
    },
    {
      title: 'Nightly model retrain failed',
      summary:
        "Last night's fraud model retrain did not complete. The current model is still serving.",
      severities: ['SEV4'],
      updates: ['Training job ran out of memory on the larger label set.'],
      resolution:
        'The retrain ran out of memory after the label backfill. Moved it to a larger instance class; the retrained model passed evaluation and was promoted.',
    },
    {
      title: 'Duplicate alert emails to analysts',
      summary:
        'Analysts are receiving each fraud alert email two or three times.',
      severities: ['SEV4'],
      updates: ['Two notifier instances are running after the last deploy.'],
      resolution:
        'A deploy left an old notifier instance running alongside the new one. Removed it and added a leader lock.',
    },
    {
      title: 'IP reputation feed stale',
      summary:
        'The IP reputation feed used in scoring has not updated for three days.',
      severities: ['SEV4', 'SEV3'],
      updates: [
        'The vendor moved the feed to a new endpoint; the old one still serves the last file.',
      ],
      resolution:
        "Pointed the importer at the vendor's new feed endpoint and added a freshness check on the feed contents, not just the download.",
    },
    {
      title: 'Refund abuse rule missing a merchant category',
      summary: 'Serial refund abuse on digital goods is not being flagged.',
      severities: ['SEV3'],
      updates: [
        'The rule covers physical goods categories only.',
        'Added digital goods and backtested against the last 30 days.',
      ],
      resolution:
        'The refund abuse rule never included digital goods. Added them after a backtest; 14 accounts were sent for review.',
    },
    {
      title: '3-D Secure exemption requests rejected',
      summary:
        'Issuers are rejecting our low-risk exemption requests and forcing challenges.',
      severities: ['SEV3', 'SEV2'],
      updates: [
        'Rejections started when our fraud-rate report to the acquirer was late.',
        'Report submitted; acquirer is restoring our exemption eligibility.',
      ],
      resolution:
        'A late fraud-rate report suspended our exemption eligibility with the acquirer. Submitted it and automated the monthly report.',
    },
    {
      title: "Risk dashboard showing yesterday's metrics",
      summary: "The risk team's dashboard has not refreshed since midnight.",
      severities: ['SEV4'],
      updates: [
        'The dashboard refresh job has lost access to the metrics warehouse.',
      ],
      resolution:
        "Renewed the dashboard service account's access to the warehouse; the dashboard caught up immediately.",
    },
  ],
};

export interface Arc extends Scenario {
  week: number;
  day: number;
  /** Declaration time of day, HH:MM UTC. */
  time: string;
  service: DemoService;
  severity: Severity;
  /** Declared at another severity, then changed by the Admin. */
  declaredAs?: Severity;
}

/** The story's larger moments, pinned to their week, day, and time. */
export const ARCS: readonly Arc[] = [
  // Card-network migration.
  {
    week: 6,
    day: 0,
    time: '09:40',
    service: 'Payment API',
    severity: 'SEV2',
    severities: ['SEV2'],
    title: 'Card authorisations timing out after network cutover',
    summary:
      'Since the cutover to the new card-network gateway, about 8% of authorisations time out.',
    updates: [
      'Timeouts are all on the new gateway; the old route is healthy.',
      'Gateway TLS handshakes are taking 3–5 s from two of our three egress IPs.',
      'Network team confirmed the new egress IPs were not yet allow-listed at the gateway.',
      'Routed through the allow-listed IP; timeouts back to baseline.',
    ],
    resolution:
      'Two of our egress IPs were not yet allow-listed by the card-network gateway. Pinned traffic to the allow-listed IP until the rest were added. Follow-up: add egress allow-listing to the migration checklist.',
  },
  {
    week: 6,
    day: 3,
    time: '14:05',
    service: 'Payment API',
    severity: 'SEV3',
    severities: ['SEV3'],
    title: 'Duplicate authorisation holds on Visa debit',
    summary:
      'Some Visa debit cardholders see two pending holds for one purchase. Only one is captured.',
    updates: [
      'The gateway retries a timed-out authorisation without our idempotency reference.',
      'Holds from the retries are being reversed automatically after 20 minutes.',
      'Gateway config updated to pass our reference through on retry.',
    ],
    resolution:
      'Gateway retries were creating second authorisations. It now carries our reference on retry, and the stray holds were reversed. Support has a macro for affected cardholders.',
  },
  {
    week: 7,
    day: 1,
    time: '11:18',
    service: 'Payment API',
    severity: 'SEV1',
    severities: ['SEV1'],
    title: 'Checkout failing for Visa transactions',
    summary:
      'All Visa authorisations are failing through the new network gateway. Mastercard and Amex are unaffected. Checkout is down for roughly 55% of card payments.',
    updates: [
      'Every Visa request gets a format error back from the gateway.',
      "Today's gateway release changed the field order for Visa's cryptogram data.",
      'Failing Visa traffic over to the legacy route now.',
      'Visa authorisations succeeding on the legacy route; approval rate recovering.',
      'Gateway vendor rolled back their release; moving Visa back to the new route gradually.',
      'All Visa traffic on the new route for 30 minutes with a normal approval rate.',
    ],
    resolution:
      "The gateway vendor's release changed the Visa cryptogram field order, failing every Visa authorisation for 34 minutes. We failed over to the legacy route and the vendor rolled back. Follow-up: keep the legacy route warm until the migration is finished, and add a synthetic Visa transaction every minute.",
  },
  {
    week: 7,
    day: 2,
    time: '08:52',
    service: 'Payment API',
    severity: 'SEV2',
    severities: ['SEV2'],
    title: 'Settlement file rejected by acquirer',
    summary:
      "The acquirer rejected yesterday's settlement file, which included transactions from the failover window.",
    updates: [
      'Rejection is for mixed routing codes in one file.',
      'Splitting the file by route and regenerating.',
      'Both files accepted by the acquirer.',
    ],
    resolution:
      "Yesterday's failover put two routing codes in one settlement file. Split it by route and resubmitted before the cut-off; settlement was on time.",
  },
  {
    week: 8,
    day: 0,
    time: '16:30',
    service: 'Payment API',
    severity: 'SEV2',
    declaredAs: 'SEV3',
    severities: ['SEV2'],
    title: '3-D Secure challenges timing out for EU issuers',
    summary:
      'EU cardholders asked for a 3-D Secure challenge are timing out before they can complete it.',
    updates: [
      'Affects challenges routed through the new gateway only.',
      'Challenge window is set to 60 s on the new gateway against 300 s on the old one.',
      'Challenge timeout corrected; completion rate back up.',
    ],
    resolution:
      'The new gateway was configured with a 60-second 3-D Secure challenge window. Set it to 300 seconds to match the old route. Escalated to SEV2 once it was clear all EU issuers were affected.',
  },
  // Signing-key rotation.
  {
    week: 11,
    day: 5,
    time: '02:14',
    service: 'Authentication',
    severity: 'SEV1',
    severities: ['SEV1'],
    title: 'Users signed out after signing-key rotation',
    summary:
      'Every signed-in session was invalidated at 02:00 UTC and new sign-ins fail. Customers cannot reach the dashboard or the mobile app.',
    updates: [
      'Token validation fails with an unknown key id on every service.',
      'The scheduled rotation published the new key but removed the old one from the key set immediately.',
      'Services are caching the key set for 1 hour, so they have neither key.',
      'Restored the previous key to the key set; forcing a key-set refresh on every service.',
      'Sign-ins succeeding again; sessions issued since 02:00 are valid.',
      'Watching error rates through the morning traffic peak.',
    ],
    resolution:
      'The rotation removed the old signing key before services had fetched the new one, so no token could be validated until the old key was put back. Restored both keys and made rotation publish the new key a day before retiring the old one. Follow-up: rotation rehearsal in staging before the next scheduled run.',
  },
  {
    week: 11,
    day: 0,
    time: '10:20',
    service: 'Authentication',
    severity: 'SEV3',
    severities: ['SEV3'],
    title: 'Token refresh latency after key-set change',
    summary: "Token refresh p95 is 2.5 s since Saturday's key-set fix.",
    updates: [
      'Every refresh fetches the key set from origin: the cache TTL was set to 0 during the incident.',
      'Restored the cache TTL with the new overlap-aware refresh.',
    ],
    resolution:
      "The key-set cache TTL left at 0 after Saturday's incident sent every refresh to origin. Restored a 10-minute TTL, which is safe now that rotations overlap.",
  },
  // Fraud-model rollout.
  {
    week: 16,
    day: 1,
    time: '13:45',
    service: 'Fraud Detection',
    severity: 'SEV2',
    severities: ['SEV2'],
    title: 'Fraud model v7 declining legitimate card-present payments',
    summary:
      'After the v7 rollout, card-present decline rate rose from 0.4% to 3.1%. Merchants are reporting declined in-store payments.',
    updates: [
      'Declines concentrate on contactless payments under £30.',
      'v7 treats the missing CVV on contactless as a fraud signal; v6 ignored it.',
      'Routed card-present traffic back to v6.',
      'Card-present decline rate back to 0.4%.',
    ],
    resolution:
      'Model v7 misread missing CVV on contactless payments as risk. Card-present traffic is back on v6 while v7 is retrained with the channel feature. Follow-up: shadow-score each channel before rollout.',
  },
  {
    week: 16,
    day: 4,
    time: '09:10',
    service: 'Fraud Detection',
    severity: 'SEV3',
    severities: ['SEV3'],
    title: 'Manual review queue backlog above 4 hours',
    summary:
      "Tuesday's false declines left a review backlog; merchants are waiting over 4 hours for decisions.",
    updates: [
      'Queue at 2,400 cases; most are from the v7 window.',
      'Bulk-approving v7-window cases that v6 scores as low risk.',
      'Queue under 200 and review time under 30 minutes.',
    ],
    resolution:
      'Cleared the backlog left by the v7 false declines, bulk-approving cases that v6 scored as low risk after an analyst sampled 100 of them.',
  },
  {
    week: 17,
    day: 2,
    time: '15:30',
    service: 'Fraud Detection',
    severity: 'SEV2',
    severities: ['SEV2'],
    title: 'Scoring latency p99 above 900 ms',
    summary:
      'Risk scoring p99 latency has tripled since v7.1 went to 25% of traffic; checkout times out on slow scores.',
    updates: [
      'Latency is in feature retrieval, not inference.',
      'v7.1 requests 40 more features, fetched one by one.',
      'Enabled batched feature fetches for v7.1.',
      'p99 back to 280 ms.',
    ],
    resolution:
      'Model v7.1 fetched its extra features serially. Batched feature retrieval brought p99 from 950 ms to 280 ms. Follow-up: latency budget check in the model promotion pipeline.',
  },
  {
    week: 17,
    day: 6,
    time: '20:05',
    service: 'Fraud Detection',
    severity: 'SEV1',
    severities: ['SEV1'],
    title: 'Scoring service rejecting all requests',
    summary:
      'The scoring service is returning errors for every request. Payments are falling back to rules-only decisions, with higher fraud exposure.',
    updates: [
      'Every scoring pod is crash-looping on start-up.',
      'The model artifact published at 19:58 is truncated.',
      'Pinned the previous artifact; pods starting.',
      'Scoring back for all traffic; rules-only window was 31 minutes.',
      'Reviewing transactions approved rules-only for fraud.',
    ],
    resolution:
      'A truncated model artifact crashed every scoring pod, leaving payments on rules-only decisions for 31 minutes. Pinned the previous artifact; publishing now verifies the checksum before promotion. The rules-only approvals were reviewed and 3 were refunded as fraud.',
  },
  // Database failover.
  {
    week: 22,
    day: 3,
    time: '10:02',
    service: 'Payment API',
    severity: 'SEV2',
    severities: ['SEV2'],
    title: 'Payment API 5xx during database failover',
    summary:
      'A planned database failover took longer than expected; charge creation returned 5xx for several minutes.',
    updates: [
      'Failover completed, but API pods are holding connections to the old primary.',
      'Rolling restart of API pods.',
      'Error rate back to baseline.',
    ],
    resolution:
      'API pods kept connections to the old primary after the failover. A rolling restart fixed it; connection validation on checkout is now enabled so the next failover recovers on its own.',
  },
  {
    week: 22,
    day: 3,
    time: '10:15',
    service: 'Authentication',
    severity: 'SEV3',
    severities: ['SEV3'],
    title: 'Sign-in errors during database failover',
    summary:
      'Some sign-ins fail with a server error during the database failover.',
    updates: [
      'Same stale-connection behaviour as the Payment API.',
      'Restarted the auth pods; sign-ins recovered.',
    ],
    resolution:
      'Auth pods held stale connections after the failover, like the Payment API. Restarted them and enabled the same connection validation.',
  },
];

export interface ActiveResponse {
  responder: string;
  /** Minutes after the declaration. */
  start: number;
  /** Minutes after the declaration; absent while still investigating. */
  complete?: number;
  /** Minutes after the declaration, one per update. */
  updates: readonly number[];
}

export interface ActiveIncident {
  service: DemoService;
  severity: Severity;
  /** Minutes before the anchor. */
  declared: number;
  title: string;
  summary: string;
  updates: readonly string[];
  responses: readonly ActiveResponse[];
  /** Minutes after the declaration, one per coordination update. */
  adminUpdates?: readonly number[];
  /** Who declared it; the Incident Manager unless said. */
  declaredBy?: string;
  /**
   * Still waiting for someone to decide who responds — and, for the
   * Reporter's, to confirm the severity he suggested.
   */
  awaitingDecision?: boolean;
}

/** What is happening now: five incidents, each in a different state. */
export const ACTIVE: readonly ActiveIncident[] = [
  // Alex raised it minutes ago with a suggested severity; nobody has
  // decided who responds yet.
  {
    service: 'Payment API',
    severity: 'SEV3',
    declared: 12,
    title: 'Refund confirmations not emailed',
    summary:
      'Support reports customers are not receiving refund confirmation emails since this morning.',
    updates: [],
    responses: [],
    declaredBy: REPORTER,
    awaitingDecision: true,
  },
  // Declared late yesterday; Risk has not picked it up.
  {
    service: 'Fraud Detection',
    severity: 'SEV3',
    declared: 85,
    title: 'Transaction monitoring alerts delayed',
    summary: 'Fraud alerts are reaching analysts about 20 minutes late.',
    updates: [],
    responses: [],
  },
  // Sam has finished his part; Priya is still investigating.
  {
    service: 'Payment API',
    severity: 'SEV2',
    declared: 475,
    title: 'Elevated card declines from one acquirer',
    summary:
      'Decline rate on one acquirer rose from 6% to 14% at 16:00 UTC. Other acquirers are normal.',
    updates: [
      'Declines are issuer-side "do not honour" across many issuers, so not one bank.',
      "Moved 50% of that acquirer's traffic to our secondary acquirer.",
      'Acquirer confirms a degraded link to one card network; they are working on it.',
      'Secondary acquirer holding up; decline rate for moved traffic is normal.',
    ],
    responses: [
      { responder: SAM, start: 4, complete: 85, updates: [42] },
      { responder: PRIYA, start: 10, updates: [20, 120, 195] },
    ],
    adminUpdates: [30],
  },
  // Lee is looking into it between other work.
  {
    service: 'Authentication',
    severity: 'SEV4',
    declared: 2250,
    title: 'Intermittent slow sign-in for mobile app users',
    summary:
      'A few mobile users report sign-in taking 10+ seconds. Web sign-in is normal.',
    updates: [
      'Slow sign-ins are all from one older app version.',
      "That version retries the token call on a 5 s timer; suspect it's hitting a slow path.",
    ],
    responses: [{ responder: LEE, start: 70, updates: [115, 1380] }],
  },
  // Priya has completed; waiting on the Admin to resolve it.
  {
    service: 'Payment API',
    severity: 'SEV3',
    declared: 890,
    title: 'Webhook retries backing up for some merchants',
    summary:
      'Retries of failed webhooks are queueing for merchants on the legacy endpoint format.',
    updates: [
      'Only merchants still on v1 webhook signatures are affected.',
      "Retry worker for v1 was scaled to zero in last week's cleanup; restored it.",
      'Retry queue empty; nothing further needed from Payments.',
    ],
    responses: [
      { responder: PRIYA, start: 15, complete: 210, updates: [40, 115, 205] },
    ],
  },
];

/** What a responder says when the scenario's own updates have run out. */
export const FALLBACK_UPDATES: readonly string[] = [
  'No new occurrences in the last 20 minutes.',
  'Checked recent deploys and config changes; nothing else in the window.',
  'Error rate holding at baseline; keeping an eye on it.',
  'Notes are in the incident doc.',
];

/** Whoever decides: their coordination updates on the larger incidents. */
export const ADMIN_UPDATES: readonly string[] = [
  'Status page updated; support has a holding statement for customers.',
  'Account managers for the largest affected merchants have been told.',
  'Next update on the status page in 30 minutes.',
  'Status page moved to monitoring.',
];

/**
 * Known issues. Every everyday scenario that happens more than once becomes
 * one, reviewed, linked to each of its incidents; one that happens once is
 * left a one-off, as it would be until it came back. Beyond those, the
 * present ties in: an active incident can be another time of an earlier
 * scenario's (KNOWN_ISSUE_LINKS), or one the Admin has yet to review, saved
 * while it was declared (SAVED_WHILE_DECLARING).
 */
export const KNOWN_ISSUE_LINKS: readonly {
  service: DemoService;
  /** The active incident's title. */
  title: string;
  /** The everyday scenario whose known issue it is another time of. */
  knownIssue: string;
}[] = [
  {
    service: 'Payment API',
    title: 'Webhook retries backing up for some merchants',
    knownIssue: 'Merchant webhook deliveries delayed',
  },
];

/** Active incidents declared as something new, kept for the Admin to review. */
export const SAVED_WHILE_DECLARING: readonly string[] = [
  'Elevated card declines from one acquirer',
];
