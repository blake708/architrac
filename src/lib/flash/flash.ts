// One-time messages that survive a page change ("Project 2026-023 created").
// The server action leaves a short-lived cookie; <FlashToast> on the next
// page shows it once and deletes it. No secrets: it's just the message.

export const FLASH_COOKIE = "architrac-flash";
export const FLASH_MAX_AGE_SECONDS = 60;

/** Read the flash message from a cookie string (document.cookie). */
export function takeFlash(cookieString: string): string | null {
  const hit = cookieString
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(FLASH_COOKIE.length + 1)) || null;
  } catch {
    return null;
  }
}
