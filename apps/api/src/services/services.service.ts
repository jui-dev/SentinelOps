import { Injectable, Logger } from '@nestjs/common';

import { opaqueSlug, slugify } from '../common/slug.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { teamNotFound } from '../teams/teams.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type { ServiceResponse } from './services.contract.js';
import {
  serviceHasIncidents,
  serviceNameTaken,
  serviceNotFound,
} from './services.errors.js';
import { toServiceResponse } from './services.responses.js';
import type {
  CreateServiceRequest,
  UpdateServiceRequest,
} from './services.schemas.js';

/**
 * Prisma's answer to an update whose where matched no row: here, a service
 * that is not in this organization, or an organization soft-deleted since
 * admission.
 */
const RECORD_NOT_FOUND = 'P2025';

/**
 * Columns a service response is built from. The owner is identity only —
 * never `ownerTeam.memberships`.
 */
const serviceSelection = {
  id: true,
  name: true,
  slug: true,
  description: true,
  criticality: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  ownerTeam: { select: { id: true, name: true, slug: true } },
} as const;

/** The slug index, by constraint name or by its columns. */
const isSlugConflict = (hint: string): boolean => hint.includes('slug');

/** The exact-name index, by constraint name or by its columns. */
const isNameConflict = (hint: string): boolean => hint.includes('name');

/**
 * The composite owner key refused the row: the team is not in this
 * organization, or was deleted after it was looked up. Matched on the
 * referencing column — the constraint name also contains `organization_id`,
 * which the plain organization key shares.
 */
const violatesOwnerTeamKey = (hint: string): boolean =>
  hint.includes('owner_team') || hint.includes('ownerteam');

/**
 * A service delete refused because incidents are recorded against it. The
 * incidents' key is the only one that can refuse deleting a service.
 */
const violatesIncidentServiceKey = (hint: string): boolean =>
  hint.includes('incidents') ||
  hint.includes('service_id') ||
  hint.includes('serviceid');

/**
 * The slug for a name that yields none — only non-Latin script, or only
 * punctuation. Clients never supply a slug, so a name that cannot be slugged
 * gets an opaque one rather than being refused.
 */
export const fallbackServiceSlug = (): string => opaqueSlug('service');

/**
 * An organization's services, and who owns them.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument and every query filters
 * by it, so each is correct with no guard in front of it.
 *
 * Tenant consistency of ownership does not rely on this service either: the
 * composite foreign key on services makes an owner from another organization
 * unrepresentable. The team lookups here exist to give the right 404, not to
 * keep the data consistent.
 *
 * Reads teams through Prisma rather than through TeamsService: the services
 * module depends on the teams table and its error code, not on the teams
 * module.
 */
@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Every service in the organization, by name. */
  async list(organizationId: string): Promise<ServiceResponse[]> {
    const services = await this.prisma.service.findMany({
      where: { organizationId, organization: { deletedAt: null } },
      select: serviceSelection,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return services.map(toServiceResponse);
  }

  /** One service, looked up by its id and the organization together. */
  async get(
    organizationId: string,
    serviceId: string,
  ): Promise<ServiceResponse> {
    if (!isResourceId(serviceId)) {
      throw serviceNotFound();
    }

    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: serviceSelection,
    });

    if (!service) {
      throw serviceNotFound();
    }

    return toServiceResponse(service);
  }

  /**
   * Creates a service, owned by a team of this organization, with a slug
   * derived from its name.
   *
   * The owner is looked up within the organization first, for the right 404.
   * If it is deleted between that read and the insert, the composite foreign
   * key refuses the insert, answered with the same 404. Uniqueness is the
   * database's, exactly as for teams.
   */
  async create(
    organizationId: string,
    input: CreateServiceRequest,
    makeFallbackSlug: () => string = fallbackServiceSlug,
  ): Promise<ServiceResponse> {
    const derived = slugify(input.name);
    const candidates = derived
      ? [derived]
      : [makeFallbackSlug(), makeFallbackSlug()];

    for (const [attempt, slug] of candidates.entries()) {
      try {
        const service = await this.prisma.$transaction(async (tx) => {
          await this.requireActiveOrganization(tx, organizationId);
          await this.requireTeam(tx, organizationId, input.ownerTeamId);

          // Scalar ids, not nested connects: both relations share
          // organizationId, and it is that shared column the owner key checks.
          return tx.service.create({
            data: {
              organizationId,
              name: input.name,
              slug,
              description: input.description ?? null,
              ownerTeamId: input.ownerTeamId,
              criticality: input.criticality,
            },
            select: serviceSelection,
          });
        });

        this.logger.log('Service created', {
          serviceId: service.id,
          ownerTeamId: service.ownerTeam.id,
        });

        return toServiceResponse(service);
      } catch (error) {
        const foreignKey = foreignKeyViolationHint(error);

        if (foreignKey !== undefined && violatesOwnerTeamKey(foreignKey)) {
          throw teamNotFound();
        }

        const hint = uniqueViolationHint(error);

        if (hint === undefined) {
          throw error;
        }

        if (isNameConflict(hint)) {
          throw serviceNameTaken();
        }

        if (isSlugConflict(hint)) {
          if (derived) {
            throw serviceNameTaken();
          }

          if (attempt < candidates.length - 1) {
            continue;
          }
        }

        // An unrecognised constraint, or a second fallback collision: a
        // genuine fault, surfaced as a masked 500 rather than a guessed 409.
        throw error;
      }
    }

    // Unreachable: every iteration returns or throws.
    throw new Error('Service creation exhausted its slug candidates');
  }

  /**
   * Renames a service, changes its description or criticality, moves it to
   * another team of this organization, or archives or unarchives it. Never
   * its slug.
   *
   * Archiving stamps the time now; unarchiving clears it. Archiving an
   * archived service keeps the original time. Archiving is allowed while
   * incidents on the service are still active — they carry on — and it waits
   * on any declaration holding the service's row lock, so a declaration and
   * an archive always happen one after the other.
   *
   * The service is judged before the team, so a service this organization
   * lacks answers SERVICE_NOT_FOUND whatever the body names. A team deleted
   * between its lookup and the write is refused by the owner key, and
   * answered as the lookup would have been.
   */
  async update(
    organizationId: string,
    serviceId: string,
    input: UpdateServiceRequest,
  ): Promise<ServiceResponse> {
    if (!isResourceId(serviceId)) {
      throw serviceNotFound();
    }

    try {
      const { service, archivedChanged } = await this.prisma.$transaction(
        async (tx) => {
          const current = await this.requireService(
            tx,
            organizationId,
            serviceId,
          );

          if (input.ownerTeamId !== undefined) {
            await this.requireTeam(tx, organizationId, input.ownerTeamId);
          }

          const wasArchived = current.archivedAt !== null;
          const archivedChanged =
            input.archived !== undefined && input.archived !== wasArchived;

          const updated = await tx.service.update({
            where: {
              organizationId_id: { organizationId, id: serviceId },
              organization: { deletedAt: null },
            },
            data: {
              name: input.name,
              description: input.description,
              ownerTeamId: input.ownerTeamId,
              criticality: input.criticality,
              archivedAt: archivedChanged
                ? input.archived
                  ? new Date()
                  : null
                : undefined,
            },
            select: serviceSelection,
          });

          return { service: updated, archivedChanged };
        },
      );

      this.logger.log(
        'Service updated',
        input.ownerTeamId === undefined
          ? { serviceId }
          : { serviceId, ownerTeamId: input.ownerTeamId },
      );

      if (archivedChanged) {
        this.logger.log(
          service.archivedAt ? 'Service archived' : 'Service unarchived',
          { serviceId },
        );
      }

      return toServiceResponse(service);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw serviceNotFound();
      }

      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey !== undefined && violatesOwnerTeamKey(foreignKey)) {
        throw teamNotFound();
      }

      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isNameConflict(hint)) {
        throw serviceNameTaken();
      }

      throw error;
    }
  }

  /**
   * Deletes a service nothing references. A service with incidents is not
   * deleted: their foreign key refuses it, and that refusal is the 409 — not
   * checked first, which would race a declaration in between. Such a service
   * is retired by archiving it instead.
   */
  async delete(organizationId: string, serviceId: string): Promise<void> {
    if (!isResourceId(serviceId)) {
      throw serviceNotFound();
    }

    let count: number;

    try {
      ({ count } = await this.prisma.service.deleteMany({
        where: {
          id: serviceId,
          organizationId,
          organization: { deletedAt: null },
        },
      }));
    } catch (error) {
      const hint = foreignKeyViolationHint(error);

      if (hint !== undefined && violatesIncidentServiceKey(hint)) {
        throw serviceHasIncidents();
      }

      throw error;
    }

    if (count === 0) {
      throw serviceNotFound();
    }

    this.logger.log('Service deleted', { serviceId });
  }

  /** The service exists in this organization, or 404. */
  private async requireService(
    db: Prisma.TransactionClient,
    organizationId: string,
    serviceId: string,
  ): Promise<{ archivedAt: Date | null }> {
    const service = await db.service.findFirst({
      where: {
        id: serviceId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { archivedAt: true },
    });

    if (!service) {
      throw serviceNotFound();
    }

    return service;
  }

  /**
   * The team exists in this organization, or 404 TEAM_NOT_FOUND — the same
   * answer for a missing team and for another organization's.
   */
  private async requireTeam(
    db: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<void> {
    const team = await db.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!team) {
      throw teamNotFound();
    }
  }

  /**
   * The organization still exists. Admission checked this, but it could be
   * soft-deleted since — and a service called with no guard must not create a
   * service in a deleted tenant.
   */
  private async requireActiveOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const organization = await tx.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { id: true },
    });

    if (!organization) {
      throw organizationNotFound();
    }
  }
}
