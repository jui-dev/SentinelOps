import type { DemoPart } from './demo-parts.js';

/** TEMPORARY — one part of the demo, as the Settings page shows it. */
export interface DemoPartResponse {
  id: DemoPart;
  required: boolean;
  needs: DemoPart[];
  /** How many of its rows the organization holds now. */
  count: number;
  loaded: boolean;
  /** Can be generated on its own; otherwise only with the full demo. */
  generatable: boolean;
}

/** What `GET /organizations/:organizationId/demo` returns. */
export interface DemoWorkspaceResponse {
  parts: DemoPartResponse[];
  /** Every part loaded. */
  complete: boolean;
  lastResetAt: string | null;
  lastResetBy: { id: string; name: string } | null;
  /** 00:00 UTC of the day the generated history ends on. */
  historyEndsAt: string | null;
}
