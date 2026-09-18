/**
 * Derives a URL-safe slug from a display name: lowercase ASCII letters and
 * digits, separated by single hyphens, at most 48 characters.
 *
 * Returns undefined when nothing usable survives — a name of only punctuation
 * or non-Latin script. It never invents a fallback and never appends a
 * uniqueness suffix: what to do then, and on a collision, is the caller's
 * decision. Registration asks for an explicit slug; teams use an opaque one.
 */
export const slugify = (name: string): string | undefined => {
  const slug = name
    .normalize('NFKD')
    // Strip the combining marks NFKD just separated out, so a name like
    // "Ubernacht" written with an umlaut slugs to 'ubernacht' rather than
    // losing the character entirely. Escaped rather than written literally:
    // a combining mark in source is invisible and survives editing by luck.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    // A truncation at 48 can leave a trailing hyphen behind.
    .replace(/-+$/g, '');

  return slug.length >= 2 ? slug : undefined;
};
