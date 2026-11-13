import { cn } from "@/lib/cn";

// Filter buttons grouped in a grey tray (mockup: Contacts "Filter by type",
// Team "Filter by team"). Uppercase; the chosen one is white and raised.
// Use on a role="group" wrapper with aria-pressed buttons.

export const segmentGroupClasses =
  "inline-flex w-fit flex-wrap gap-0.5 rounded-sm bg-track p-[3px]";

export function segmentClasses(on: boolean) {
  return cn(
    "cap h-[30px] cursor-pointer rounded-sm border-0 px-3 text-xs tracking-[0.06em] whitespace-nowrap",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue",
    on
      ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(20,20,20,0.14)]"
      : "bg-transparent font-medium text-ink-3 hover:text-ink",
  );
}
