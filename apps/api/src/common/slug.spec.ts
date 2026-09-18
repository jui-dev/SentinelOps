import { opaqueSlug, slugify } from './slug.js';

describe('slugify', () => {
  it('should lowercase and hyphenate', () => {
    expect(slugify('Acme Operations')).toBe('acme-operations');
  });

  it('should collapse runs of punctuation into one hyphen', () => {
    expect(slugify('Acme --- Ops!!! Team')).toBe('acme-ops-team');
  });

  it('should strip leading and trailing separators', () => {
    expect(slugify('  ...Acme Ops...  ')).toBe('acme-ops');
  });

  it('should fold accents rather than dropping the letter', () => {
    // Built from an escape so the combining mark is visible in source.
    const name = 'Übernacht Betrieb';

    expect(slugify(name)).toBe('ubernacht-betrieb');
  });

  it('should truncate to 48 characters without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(47)} bcd`);

    expect(slug).toBeDefined();
    expect(slug?.length).toBeLessThanOrEqual(48);
    expect(slug?.endsWith('-')).toBe(false);
  });

  it.each([['!!!'], ['   '], [''], ['a'], ['-']])(
    'should return undefined for %j rather than inventing a name',
    (name) => {
      expect(slugify(name)).toBeUndefined();
    },
  );
});

describe('opaqueSlug', () => {
  it('should produce a slug-shaped value under the prefix', () => {
    const slug = opaqueSlug('service');

    expect(slug).toMatch(/^service-[0-9a-f]{8}$/);
    expect(slugify(slug)).toBe(slug);
  });

  it('should be unpredictable', () => {
    expect(opaqueSlug('team')).not.toBe(opaqueSlug('team'));
  });
});
