/**
 * TEMPORARY — the demo's incident analyses: written up for the incidents in
 * the story that most deserve one, so the Learn step has something to read.
 * Six published, two still drafts. Each is found by its incident's title;
 * one whose incident is not in the history is skipped.
 *
 * Who did what follows the application's rules: an Incident Manager starts
 * an analysis and picks who writes it — a Responder who worked the
 * incident — and publishes it once its summary is done.
 */

export type DemoAnalysisSection = 'summary' | 'impact' | 'cause' | 'lessons';

export interface DemoAnalysis {
  /** The incident's title, as demo-story.ts has it. */
  incident: string;
  status: 'DRAFT' | 'PUBLISHED';
  /** Days after the incident was resolved that it was started. */
  startedAfterDays: number;
  /** Days after it was started that it was published; drafts have none. */
  publishedAfterDays?: number;
  sections: Partial<Record<DemoAnalysisSection, string>>;
  /** The sections marked done; a published one has its summary done. */
  done: readonly DemoAnalysisSection[];
}

const ALL: readonly DemoAnalysisSection[] = [
  'summary',
  'impact',
  'cause',
  'lessons',
];

export const DEMO_ANALYSES: readonly DemoAnalysis[] = [
  {
    incident: 'Checkout failing for Visa transactions',
    status: 'PUBLISHED',
    startedAfterDays: 1,
    publishedAfterDays: 3,
    sections: {
      summary:
        'For 34 minutes every Visa authorisation through the new card-network gateway failed. A vendor release changed the order of the Visa cryptogram fields; we failed over to the legacy route and the vendor rolled their release back.',
      impact:
        'About 55% of card payments failed at checkout for 34 minutes: roughly 4,100 declined attempts, of which about 60% were retried successfully once the legacy route took over. Mastercard and Amex were unaffected.',
      cause:
        "The gateway vendor shipped a release that reordered fields in the Visa cryptogram. Our integration validated the field set but not its order, and the change was not in the vendor's release notes. With the legacy route cold, failing over took longer than it should have.",
      lessons:
        'Keep the legacy route warm until the migration is complete. Run a synthetic Visa transaction every minute and page on two failures in a row. Ask the vendor for a staging window before their releases during our migration.',
    },
    done: ALL,
  },
  {
    incident: 'Users signed out after signing-key rotation',
    status: 'PUBLISHED',
    startedAfterDays: 1,
    publishedAfterDays: 4,
    sections: {
      summary:
        'The scheduled signing-key rotation retired the old key in the same step that published the new one. Services still caching the old key set could validate no token, so every session ended and new sign-ins failed until the old key was put back.',
      impact:
        'Every signed-in customer was signed out at 02:00 UTC, and nobody could sign in to the dashboard or the mobile apps for 47 minutes. Overnight traffic kept the number of affected sign-in attempts to about 9,000.',
      cause:
        'Rotation removed the outgoing key from the key set immediately. Services cache the key set for an hour, so for up to an hour they held neither the old key nor the new one. Rotation had never been run end to end outside production.',
      lessons:
        'Rotation now publishes the new key a day before retiring the old one. Rehearse every rotation in staging first, and alert on token validation failures by key id.',
    },
    done: ALL,
  },
  {
    incident: 'Duplicate authorisation holds on Visa debit',
    status: 'PUBLISHED',
    startedAfterDays: 2,
    publishedAfterDays: 2,
    sections: {
      summary:
        'Retries through the new gateway created a second authorisation for some Visa debit purchases, leaving cardholders with two pending holds. Only one was ever captured; the strays were reversed.',
      impact:
        'About 1,300 cardholders saw a second hold for up to five days, and support took around 180 contacts about it. No customer was charged twice.',
      cause:
        'On a timeout the gateway retried the authorisation without our idempotency reference, so the network treated it as a new one.',
      lessons:
        'The gateway now carries our reference on every retry. Reconciliation flags two open holds for one order, and support has a macro for affected cardholders.',
    },
    done: ALL,
  },
  {
    incident: 'Subscription renewals charged twice',
    status: 'PUBLISHED',
    startedAfterDays: 1,
    publishedAfterDays: 2,
    sections: {
      summary:
        'A scheduler failover ran the monthly renewal job twice, charging 212 subscribers twice. All were refunded the same day.',
      impact:
        '212 customers were charged twice for one renewal and refunded within six hours. Eleven contacted support.',
      cause:
        'The renewal job relied on the scheduler to run it once. When the scheduler failed over mid-run, the standby started the job again from the beginning.',
      lessons:
        'The job takes a per-period lock before charging, so a second run finds nothing to do. Any job that moves money must be safe to run twice.',
    },
    done: ALL,
  },
  {
    incident: 'Rule deployed with an inverted threshold',
    status: 'PUBLISHED',
    startedAfterDays: 1,
    publishedAfterDays: 3,
    sections: {
      summary:
        'A new high-value fraud rule shipped with its comparison inverted, queuing low-value transactions for review instead of high-value ones. It was rolled back and the queued cases were released.',
      impact:
        'About 2,700 low-value transactions waited for manual review for up to 90 minutes, and analysts lost most of a shift to the queue. No high-value fraud got through.',
      cause:
        "The rule's threshold was written as less-than instead of greater-than, and rules went live without running against real traffic first.",
      lessons:
        'Rules must now pass a shadow-mode run, scoring live traffic without acting on it, before they go live.',
    },
    done: ALL,
  },
  {
    incident: 'Card authorisations timing out after network cutover',
    status: 'PUBLISHED',
    startedAfterDays: 2,
    publishedAfterDays: 3,
    sections: {
      summary:
        'After the cutover to the new card-network gateway about 8% of authorisations timed out: two of our egress IPs had not been allow-listed by the gateway.',
      impact:
        'Roughly one in twelve card payments failed or was slow for two hours after the cutover. Most customers retried successfully.',
      cause:
        "Allow-listing our egress IPs was not on the migration checklist; only the primary IP had been sent to the gateway's team.",
      lessons:
        'Egress allow-listing is now on the migration checklist, checked from every egress IP before a cutover.',
    },
    done: ALL,
  },
  {
    incident: 'Settlement file rejected by acquirer',
    status: 'DRAFT',
    startedAfterDays: 1,
    sections: {
      summary:
        'The failover during the Visa outage put two routing codes in one settlement file, which the acquirer rejected. We split it by route and resubmitted before the cut-off.',
      impact:
        'Settlement was on time. Finance spent the morning confirming the resubmitted totals.',
    },
    done: ['summary'],
  },
  {
    incident: 'Token refresh latency after key-set change',
    status: 'DRAFT',
    startedAfterDays: 2,
    sections: {
      summary:
        'The key-set cache TTL was left at 0 after the signing-key incident, so every token refresh fetched the key set from origin.',
    },
    done: [],
  },
];
