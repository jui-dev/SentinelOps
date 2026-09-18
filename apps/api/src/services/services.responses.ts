import type {
  ServiceCriticality,
  ServiceResponse,
} from './services.contract.js';

/**
 * Row-to-wire mapper for services. Same rules as auth.responses.ts: every
 * emitted field is named, nothing is spread from a row, and inputs are
 * structural rather than Prisma model types.
 */

interface ServiceRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  criticality: ServiceCriticality;
  createdAt: Date;
  updatedAt: Date;
  ownerTeam: { id: string; name: string; slug: string };
}

/** The owner is identity only — never its members or other services. */
export const toServiceResponse = (service: ServiceRow): ServiceResponse => ({
  id: service.id,
  name: service.name,
  slug: service.slug,
  description: service.description,
  criticality: service.criticality,
  ownerTeam: {
    id: service.ownerTeam.id,
    name: service.ownerTeam.name,
    slug: service.ownerTeam.slug,
  },
  createdAt: service.createdAt.toISOString(),
  updatedAt: service.updatedAt.toISOString(),
});
