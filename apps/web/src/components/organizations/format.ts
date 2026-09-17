/** `OWNER` → `Owner`. Display only; nothing branches on a role name. */
export const formatRole = (role: string): string =>
  role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
