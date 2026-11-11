/**
 * Who may write one incident analysis: its owner, or whoever runs
 * incidents' lifecycles. Both must also hold `incident-analyses:write`.
 *
 * The role table grants the verb; this narrows it to the analysis, as
 * IncidentsService narrows `incidents:respond` to the responsible team. The
 * role is the caller's admitted one, judged by the same table the guards
 * use — never by its name.
 *
 * Pure: the caller and the owner are given, never looked up.
 */

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import type { Role } from '../generated/prisma/enums.js';
import { ANALYSIS_SECTIONS } from './incident-analyses.schemas.js';
import type { AnalysisSection } from './incident-analyses.schemas.js';

export interface AnalysisCaller {
  membershipId: string;
  role: Role;
}

export const mayWriteAnalysis = (
  caller: AnalysisCaller,
  analysis: { ownerMembershipId: string },
): boolean =>
  hasPermission(caller.role, Permission.INCIDENT_ANALYSES_WRITE) &&
  (hasPermission(caller.role, Permission.INCIDENTS_MANAGE) ||
    analysis.ownerMembershipId === caller.membershipId);

/** A draft's sections as they stand: the text of each, and which are done. */
type SectionState = Record<AnalysisSection, string | null> & {
  doneSections: readonly string[];
};

/** What one edit asks: new text for some sections, and which to mark. */
type SectionEdit = Partial<Record<AnalysisSection, string | null>> & {
  markDone?: readonly AnalysisSection[];
  reopen?: readonly AnalysisSection[];
};

/**
 * Which sections are done once an edit applies, or `null` when it marks done
 * a section that would hold no text.
 *
 * A section stops being done when its text actually changes, whoever sends
 * the change: "done" describes the words that were finished, not whatever
 * replaced them. Sending the same text again changes nothing. An edit may
 * change a section and mark it done at once, which is how finishing one is
 * saved. Pure: what stands and what is asked are given.
 */
export const nextDoneSections = (
  current: SectionState,
  edit: SectionEdit,
): AnalysisSection[] | null => {
  const textAfter = (section: AnalysisSection) =>
    edit[section] === undefined ? current[section] : edit[section];

  if (edit.markDone?.some((section) => textAfter(section) === null)) {
    return null;
  }

  return ANALYSIS_SECTIONS.filter((section) => {
    if (edit.markDone?.includes(section)) return true;
    if (edit.reopen?.includes(section)) return false;

    return (
      current.doneSections.includes(section) &&
      textAfter(section) === current[section]
    );
  });
};
