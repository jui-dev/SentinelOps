/**
 * The theme's pre-paint half. A plain module, not a client one: the root
 * layout is a Server Component and needs these as values, and a server
 * import from a "use client" module yields a client reference instead.
 */

export const THEME_STORAGE_KEY = "sentinelops.theme";

/**
 * Runs in <head> during HTML parsing, before the first paint, and applies a
 * stored explicit choice. With none, nothing is set and the operating system
 * decides through `color-scheme`.
 *
 * Deliberately constant — it interpolates nothing — so a future Content
 * Security Policy can allow it by hash rather than by 'unsafe-inline'.
 * Changing a single character changes that hash.
 */
export const THEME_INIT_SCRIPT =
  '(function(){try{var t=localStorage.getItem("sentinelops.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()';
