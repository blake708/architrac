"use client";

import { useEffect } from "react";

/**
 * Marks the page as interactive (<html data-hydrated>) once React has taken
 * over the server-rendered page. Browser tests wait for it before clicking:
 * a click or a picked option before then is lost or reset. No effect for people.
 */
export function HydratedMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
