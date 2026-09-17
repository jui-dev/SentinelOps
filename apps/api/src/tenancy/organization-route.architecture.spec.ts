import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Reflector } from '@nestjs/core';

import { OrganizationController } from './organization-controller.decorator.js';
import {
  IS_ORGANIZATION_SCOPED_KEY,
  ORGANIZATION_ID_PARAM,
} from './tenancy.constants.js';

/**
 * The structural half of tenant admission: an organization route cannot be
 * declared without the guard that admits requests to it.
 *
 * `@OrganizationController()` attaches the route prefix and the guard
 * together, so the only way to get one without the other is to spell the
 * route parameter somewhere else. This spec forbids exactly that, by reading
 * the source. It deliberately does not enumerate registered routes: route
 * paths are only reachable through `@nestjs/common/internal`, which is not a
 * stable API to build a safety net on.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECORATOR_FILE = join('tenancy', 'organization-controller.decorator.ts');

/** Any route segment that names an organization, however it is spelled. */
const ORGANIZATION_SEGMENT = /:org[A-Za-z_]*/i;

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

/**
 * Removes comments, so documentation that mentions a route does not count as
 * declaring one. Crude, and deliberately so: it can only hide a match on a
 * line that also contains `//` inside a string, which no route declaration
 * does.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('organization route architecture', () => {
  const files = sourceFiles(SRC);

  it('should find the source tree it is meant to scan', () => {
    expect(files.map((file) => relative(SRC, file))).toContain(DECORATOR_FILE);
  });

  it('should declare an organization route segment only in @OrganizationController()', () => {
    const offenders = files
      .map((file) => relative(SRC, file))
      .filter((file) => file !== DECORATOR_FILE)
      .filter((file) =>
        ORGANIZATION_SEGMENT.test(
          withoutComments(readFileSync(join(SRC, file), 'utf8')),
        ),
      )
      .map((file) => file.split(sep).join('/'));

    expect(
      offenders,
      'Organization-scoped routes must be declared with @OrganizationController(), ' +
        'which attaches tenant admission. Do not write an organization route parameter elsewhere.',
    ).toEqual([]);
  });

  it('should declare @RequirePermission() only in organization controllers', () => {
    // At runtime a permission on any other controller fails closed with a
    // 500, because no organization was admitted. This catches it sooner.
    const offenders = files
      .map((file) => ({
        file,
        source: withoutComments(readFileSync(file, 'utf8')),
      }))
      .filter(
        ({ source }) =>
          source.includes('@RequirePermission(') &&
          !source.includes('@OrganizationController('),
      )
      .map(({ file }) => relative(SRC, file).split(sep).join('/'));

    expect(
      offenders,
      '@RequirePermission() authorizes against an admitted membership, so it ' +
        'belongs only on handlers of an @OrganizationController().',
    ).toEqual([]);
  });

  it('should spell the segment in the decorator with the name the guard reads', () => {
    const source = withoutComments(
      readFileSync(join(SRC, DECORATOR_FILE), 'utf8'),
    );

    expect(source).toContain(`'organizations/:${ORGANIZATION_ID_PARAM}'`);
  });

  it('should mark a controller it decorates as organization-scoped', () => {
    @OrganizationController('memberships')
    class ProbeController {}

    expect(
      new Reflector().get<boolean>(IS_ORGANIZATION_SCOPED_KEY, ProbeController),
    ).toBe(true);
  });
});
