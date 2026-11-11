import type { KnownIssueResponse } from "@/lib/api/contracts";

/**
 * Which existing known issue a newly saved one most likely repeats, so the
 * Admin can merge it. Pure and deliberately plain: shared words, ignoring
 * case, short words and a plural "s". Only the same service's, and only one
 * the Admin has already reviewed — two new ones are not offered for each
 * other.
 */

const words = (name: string): Set<string> =>
  new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2)
      .map((word) => word.replace(/s$/, "")),
  );

/** Shared words over the shorter name's: 1 when one name holds the other. */
export const overlap = (a: string, b: string): number => {
  const left = words(a);
  const right = words(b);
  const smaller = Math.min(left.size, right.size);

  if (smaller === 0) return 0;

  let shared = 0;

  for (const word of left) if (right.has(word)) shared += 1;

  return shared / smaller;
};

/** At least half the shorter name's words in common. */
const ALIKE = 0.5;

export const likelyDuplicateOf = (
  issue: KnownIssueResponse,
  all: readonly KnownIssueResponse[],
): KnownIssueResponse | undefined => {
  let best: { issue: KnownIssueResponse; score: number } | undefined;

  for (const other of all) {
    if (
      other.id === issue.id ||
      other.service.id !== issue.service.id ||
      other.pendingReview ||
      other.archivedAt
    ) {
      continue;
    }

    const score = overlap(issue.name, other.name);

    if (score >= ALIKE && (!best || score > best.score)) {
      best = { issue: other, score };
    }
  }

  return best?.issue;
};
