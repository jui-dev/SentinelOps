import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * TEMPORARY — the demo workspace's error codes, part of its routes' contract.
 */
export const DemoWorkspaceErrorCode = {
  DEMO_NOT_FOUND: 'DEMO_NOT_FOUND',
  DEMO_PART_NOT_FOUND: 'DEMO_PART_NOT_FOUND',
  DEMO_PART_REQUIRED: 'DEMO_PART_REQUIRED',
  DEMO_NUMBERS_TAKEN: 'DEMO_NUMBERS_TAKEN',
  DEMO_STRUCTURE_CHANGED: 'DEMO_STRUCTURE_CHANGED',
} as const;

/**
 * Outside development, or for an organization that is not a demo: there is
 * no demo workspace to speak of. 404, as for anything that does not exist.
 */
export const demoNotFound = (): NotFoundException =>
  new NotFoundException('This organization has no demo workspace', {
    errorCode: DemoWorkspaceErrorCode.DEMO_NOT_FOUND,
  });

export const demoPartNotFound = (): NotFoundException =>
  new NotFoundException('No such part of the demo', {
    errorCode: DemoWorkspaceErrorCode.DEMO_PART_NOT_FOUND,
  });

/** The accounts, teams and services go only with all the demo data. */
export const demoPartRequired = (): ConflictException =>
  new ConflictException(
    'SentinelOps needs this part to work; it is removed only with all the demo data',
    { errorCode: DemoWorkspaceErrorCode.DEMO_PART_REQUIRED },
  );

/**
 * The story's incidents keep their numbers, and someone has declared one
 * with a number the part would use since its demo data was removed.
 */
export const demoNumbersTaken = (): ConflictException =>
  new ConflictException(
    'Incidents declared since use the numbers this part needs; reset the demo to generate it',
    { errorCode: DemoWorkspaceErrorCode.DEMO_NUMBERS_TAKEN },
  );

/**
 * A demo account's role or teams, or a team or service, was changed in the
 * app: the story no longer fits it. A reset puts them back.
 */
export const demoStructureChanged = (problems: string[]): ConflictException =>
  new ConflictException(
    `The demo's people, teams or services were changed (${problems.join('; ')}); reset the demo to generate this part`,
    { errorCode: DemoWorkspaceErrorCode.DEMO_STRUCTURE_CHANGED },
  );
