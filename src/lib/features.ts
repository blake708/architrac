// Switches for parts of the app that are designed but not built yet.
// When a switch is false the element is not rendered at all (no empty slot).

export const FEATURES = {
  /** "Search everything" box in the top header. Later release. */
  globalSearch: false,
  /** Notifications bell in the top header. Later release. */
  notifications: false,
} as const;
