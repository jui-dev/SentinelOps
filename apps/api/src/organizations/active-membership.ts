import type { Prisma } from '../generated/prisma/client.js';

/**
 * Whether `membershipId` belongs to the organization now — not removed — and,
 * if so, a share lock on its row until the transaction ends.
 *
 * For a write that gives a member something to hold — a response, an
 * analysis, a team place, an assignment. Removing a member locks the row for
 * update, so the two take turns: one that waits on a removal reads the row as
 * the removal left it, and finds them gone. Without the lock, a write
 * admitted a moment before the removal could still land after it.
 */
export const lockActiveMembership = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
): Promise<boolean> => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memberships
    WHERE id = ${membershipId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND removed_at IS NULL
    FOR SHARE`;

  return rows.length > 0;
};
