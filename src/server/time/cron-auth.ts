import { timingSafeEqual } from "node:crypto";

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Anything else is
// refused, and with no secret set every request is refused.
export function cronAuthorized(header: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
