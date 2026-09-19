/**
 * A period's history: the incidents something happened to while it ran.
 *
 * An incident belongs to the history if it was declared in the period, or
 * resolved in it, or both — and it appears once either way. Its place in the
 * order is its *anchor*: the resolution when that fell in the period, and
 * the declaration otherwise, so the most recent thing to happen is first.
 */

interface HistoryRow {
  id: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface HistoryEntry<Row extends HistoryRow> {
  incident: Row;
  declaredInPeriod: boolean;
  resolvedInPeriod: boolean;
}

/** Where a row sits in the order: its resolution in the period, or its start. */
const anchor = <Row extends HistoryRow>(entry: HistoryEntry<Row>): number =>
  entry.resolvedInPeriod && entry.incident.resolvedAt
    ? entry.incident.resolvedAt.getTime()
    : entry.incident.createdAt.getTime();

const within = (moment: Date | null, period: { gte: Date; lt: Date }) =>
  moment !== null && moment >= period.gte && moment < period.lt;

/**
 * The period's most recent `limit` incidents, from the most recently
 * declared and the most recently resolved in it.
 *
 * Both lists are read `limit` deep, which is enough: an incident in neither
 * list has `limit` incidents with a later anchor than its own, so it cannot
 * belong in the answer. One declared and resolved in the period is in both,
 * and is listed once.
 *
 * The flags come from the incident's own times, not from the list it
 * arrived in: a busy period can push an incident out of the declared list
 * while its resolution keeps it in the history, and it was still declared
 * in the period.
 */
export const mergeHistory = <Row extends HistoryRow>(
  declared: readonly Row[],
  resolved: readonly Row[],
  period: { gte: Date; lt: Date },
  limit: number,
): HistoryEntry<Row>[] => {
  const entries = new Map<string, HistoryEntry<Row>>();

  for (const incident of [...declared, ...resolved]) {
    entries.set(incident.id, {
      incident,
      declaredInPeriod: within(incident.createdAt, period),
      resolvedInPeriod: within(incident.resolvedAt, period),
    });
  }

  return [...entries.values()]
    .sort(
      (a, b) =>
        anchor(b) - anchor(a) ||
        // Same instant: the newer incident first, as both lists order them.
        b.incident.createdAt.getTime() - a.incident.createdAt.getTime(),
    )
    .slice(0, limit);
};
