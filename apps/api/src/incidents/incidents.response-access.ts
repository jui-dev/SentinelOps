import type {
  IncidentResponderStatus,
  IncidentResponseAccess,
} from './incidents.contract.js';
import type { SetIncidentResponseAccessRequest } from './incidents.schemas.js';

/**
 * Who may start responding to an incident:
 *
 *   PENDING   nobody yet: the Admin has not chosen
 *   OPEN      anyone on its responsible team, on their own
 *   ASSIGNED  only the people assigned, from any team
 *
 * This decides only who may start. Whoever has started finishes, whatever
 * changes afterwards. Pure: everything judged is given.
 */

/**
 * How an incident's access begins, when it is declared and when its
 * responsible team changes.
 */
export const INITIAL_RESPONSE_ACCESS: IncidentResponseAccess = 'PENDING';

/** Why a member may not start responding, or `null` when they may. */
export type StartRefusal = 'awaiting-decision' | 'not-assigned' | 'not-on-team';

export const startRefusal = ({
  responseAccess,
  onResponsibleTeam,
  assigned,
}: {
  responseAccess: IncidentResponseAccess;
  onResponsibleTeam: boolean;
  assigned: boolean;
}): StartRefusal | null => {
  switch (responseAccess) {
    case 'PENDING':
      return 'awaiting-decision';
    case 'OPEN':
      return onResponsibleTeam ? null : 'not-on-team';
    case 'ASSIGNED':
      return assigned ? null : 'not-assigned';
  }
};

/**
 * The access and the assigned people once a choice applies.
 *
 * Opening to the team clears who was assigned. Assigning replaces them,
 * except that nobody can be taken off work they have begun: whoever is
 * investigating is kept, as is an assignee who already finished. Nobody left
 * assigned means the choice is open again.
 */
export const nextResponseAccess = (
  current: {
    assignees: readonly { membershipId: string }[];
    responders: readonly {
      membershipId: string;
      status: IncidentResponderStatus;
    }[];
  },
  choice: SetIncidentResponseAccessRequest,
): { responseAccess: IncidentResponseAccess; assigneeIds: string[] } => {
  if (choice.mode === 'OPEN') {
    return { responseAccess: 'OPEN', assigneeIds: [] };
  }

  const assigned = new Set(current.assignees.map((a) => a.membershipId));
  const staying = current.responders
    .filter(
      ({ membershipId, status }) =>
        status === 'INVESTIGATING' || assigned.has(membershipId),
    )
    .map(({ membershipId }) => membershipId);
  const assigneeIds = [...new Set([...choice.membershipIds, ...staying])];

  return {
    responseAccess: assigneeIds.length > 0 ? 'ASSIGNED' : 'PENDING',
    assigneeIds,
  };
};
