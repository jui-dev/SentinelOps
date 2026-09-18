/**
 * Link styles, shared so every link in the product behaves alike.
 *
 * - `linkClasses`: an action or destination named in prose — "Go to
 *   Services". Accent-coloured, underlined on hover.
 * - `quietLinkClasses`: an entity's name that is also a link — a service in
 *   a table, a team in a record. Reads as text in the colour of its context
 *   (`text-fg` or `text-fg-muted`, set by the caller); turns accent on hover.
 */
export const linkClasses =
  "font-medium text-accent-text underline-offset-2 hover:underline";

export const quietLinkClasses =
  "underline-offset-2 hover:text-accent-text hover:underline";
