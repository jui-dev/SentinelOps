/** `ADMIN` → `Admin`. Display only; nothing branches on a role name. */
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  INCIDENT_MANAGER: "Incident Manager",
  REPORTER: "Reporter",
  RESPONDER: "Responder",
};

/** A role as people read it: "Incident Manager", not INCIDENT_MANAGER. */
export const formatRole = (role: string): string =>
  ROLE_LABELS[role] ??
  role.charAt(0).toUpperCase() + role.slice(1).toLowerCase().replace(/_/g, " ");

/** A localized long-form date, for prose: "Sep 18, 2026". */
export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
