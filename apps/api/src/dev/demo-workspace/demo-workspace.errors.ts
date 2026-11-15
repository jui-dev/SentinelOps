import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * TEMPORARY — the demo workspace's error codes, part of its routes' contract.
 */
export const DemoWorkspaceErrorCode = {
  DEMO_NOT_FOUND: 'DEMO_NOT_FOUND',
  DEMO_PART_NOT_FOUND: 'DEMO_PART_NOT_FOUND',
  DEMO_PART_REQUIRED: 'DEMO_PART_REQUIRED',
  DEMO_PART_NOT_GENERATED_ALONE: 'DEMO_PART_NOT_GENERATED_ALONE',
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
 * A part still written with the rest of the history: reset the demo to
 * generate it. Goes once each part has a generator of its own.
 */
export const demoPartNotGeneratedAlone = (): ConflictException =>
  new ConflictException(
    'This part is generated with the full demo; reset the demo to generate it',
    { errorCode: DemoWorkspaceErrorCode.DEMO_PART_NOT_GENERATED_ALONE },
  );
