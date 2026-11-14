// Home's Mine / All firm choice (home spec, Actions), remembered in
// localStorage. Read through useSyncExternalStore so the server and the
// first paint both draw "Mine" and the saved choice follows without a
// hydration mismatch. Storage can be blocked (private window), so the
// choice also lives in memory for the visit.

export type ProjectsScope = "mine" | "all";

export const SCOPE_STORAGE_KEY = "architrac.home.projectsScope";

let memory: ProjectsScope = "mine";
const listeners = new Set<() => void>();

export function readScope(): ProjectsScope {
  try {
    const saved = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (saved === "all" || saved === "mine") return saved;
  } catch {
    // Storage blocked: use the in-memory choice.
  }
  return memory;
}

export const serverScope = (): ProjectsScope => "mine";

export function subscribeScope(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveScope(scope: ProjectsScope) {
  memory = scope;
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, scope);
  } catch {
    // Storage blocked: the choice lasts until the page is left.
  }
  for (const l of listeners) l();
}
