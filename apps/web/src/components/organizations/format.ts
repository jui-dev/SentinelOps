/** `ADMIN` → `Admin`. Display only; nothing branches on a role name. */
export const formatRole = (role: string): string =>
  role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

/** A localized long-form date, for prose: "Sep 18, 2026". */
export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
