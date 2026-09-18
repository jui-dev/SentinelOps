/**
 * Joins class names, skipping falsy parts.
 *
 * Not a merge: a later class does not override an earlier one of the same
 * property. Primitives therefore take variants for their appearance, and a
 * `className` from a caller is for layout (margins, width), not colour.
 */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");
