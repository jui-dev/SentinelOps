/**
 * The wire contract for services.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

/**
 * How much the organization depends on a service. A classification people
 * choose — shown, never sorted or computed by. See ServiceCriticality in
 * schema.prisma for what each level means.
 */
export type ServiceCriticality = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/**
 * One service. `slug` is there for a client to build URLs from; it is derived
 * by the API, never chosen by a client, and never changes.
 *
 * The owning team is embedded — identity only — so a list needs no second
 * request to name its owners.
 */
export interface ServiceResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  criticality: ServiceCriticality;
  ownerTeam: {
    id: string;
    name: string;
    slug: string;
  };
  /**
   * When the service was retired, or null while it is in use. An archived
   * service is kept — incidents still name it — but no new incident can be
   * declared against it.
   */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
