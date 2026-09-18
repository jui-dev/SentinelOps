import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const TeamsErrorCode = {
  TEAM_NOT_FOUND: 'TEAM_NOT_FOUND',
  TEAM_NAME_TAKEN: 'TEAM_NAME_TAKEN',
  TEAM_MEMBER_NOT_FOUND: 'TEAM_MEMBER_NOT_FOUND',
  ALREADY_A_TEAM_MEMBER: 'ALREADY_A_TEAM_MEMBER',
} as const;

export type TeamsErrorCode =
  (typeof TeamsErrorCode)[keyof typeof TeamsErrorCode];

/**
 * The single answer for a team that is not visible within the admitted
 * organization: malformed id, no such row, or a row belonging to another
 * organization. A team in another tenant answers exactly as a nonexistent one.
 */
export const teamNotFound = (): NotFoundException =>
  new NotFoundException('Team not found', {
    errorCode: TeamsErrorCode.TEAM_NOT_FOUND,
  });

/**
 * Another team in the organization already has this name — or, at creation,
 * one that differs only by case or punctuation, which the derived slug
 * catches. The slug is never mentioned: clients do not choose it.
 */
export const teamNameTaken = (): ConflictException =>
  new ConflictException(
    'A team with this name, or a very similar one, already exists',
    { errorCode: TeamsErrorCode.TEAM_NAME_TAKEN },
  );

/** The membership named in the path is not on this team. */
export const teamMemberNotFound = (): NotFoundException =>
  new NotFoundException('Team member not found', {
    errorCode: TeamsErrorCode.TEAM_MEMBER_NOT_FOUND,
  });

export const alreadyATeamMember = (): ConflictException =>
  new ConflictException('Already a member of this team', {
    errorCode: TeamsErrorCode.ALREADY_A_TEAM_MEMBER,
  });
