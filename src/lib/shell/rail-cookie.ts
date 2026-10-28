// The menu rail remembers whether it's collapsed in a cookie, so the server
// can draw the right width on first paint (no flash of the wide rail).

export const RAIL_COOKIE = "architrac_rail_min";
/** Same value in localStorage, matching the mockup. */
export const RAIL_STORAGE_KEY = "architrac.railMin";

export function isRailCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "1";
}

/** Save the choice for a year. Runs in the browser. */
export function saveRailCollapsed(collapsed: boolean) {
  const value = collapsed ? "1" : "0";
  document.cookie = `${RAIL_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, value);
  } catch {
    // Storage blocked (private window): the cookie is enough.
  }
}
