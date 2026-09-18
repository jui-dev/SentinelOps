import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two properties of the invitation design that are easy to break by accident
 * and cheap to check by reading the source.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path);
    }

    const isSource =
      entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts');
    const isSpec = /\.(spec|e2e-spec|integration-spec)\.ts$/.test(entry.name);

    return isSource && !isSpec ? [path] : [];
  });

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const offending = (pattern: RegExp): string[] =>
  sourceFiles(SRC)
    .filter((file) => pattern.test(withoutComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(SRC, file).split(sep).join('/'));

describe('invitation architecture', () => {
  it('should never look an invitation up by (organizationId, email) as if it were unique', () => {
    // The index behind it is partial: unique only among *open* invitations.
    // Prisma still generates an `organizationId_email` unique input for it,
    // and a findUnique through that input ignores the predicate.
    expect(
      offending(/organizationId_email/),
      'Query invitations by organization and email with findFirst/findMany ' +
        'and explicit acceptedAt/revokedAt filters instead.',
    ).toEqual([]);
  });

  it('should never put an invitation token in a route path', () => {
    // Paths are written to the access log; tokens travel in request bodies.
    expect(
      offending(/['"`][^'"`]*:token\b/i),
      'Invitation tokens belong in a POST body, never in a route segment.',
    ).toEqual([]);
  });
});
