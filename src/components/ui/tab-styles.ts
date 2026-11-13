import { cn } from "@/lib/cn";

// The menu bar of tabs under a page title (mockup: uppercase, 50px tall,
// a 3px rule under the current tab). Plain class helpers, not a component,
// so links, buttons and server components can all share them.

/** One tab. Pass whether it's the current one. */
export function tabClasses(current: boolean, className?: string) {
  return cn(
    "cap inline-flex h-[50px] shrink-0 cursor-pointer items-center border-0 bg-transparent px-3 text-[12.5px] tracking-[0.07em] whitespace-nowrap no-underline",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue",
    current
      ? "font-bold text-ink shadow-[inset_0_-3px_0_var(--color-ink)]"
      : "font-medium text-ink-3 hover:text-ink",
    className,
  );
}

/** The row of tabs. */
export const tabRowClasses =
  "m-0 flex list-none gap-1.5 overflow-x-auto overflow-y-hidden p-0";

/** A tab bar inside the white page-header band, under a thin rule. */
export const headerTabBarClasses =
  "border-t border-line-soft px-1 pt-1 md:px-[calc(var(--spacing-page-x)-12px)]";

/** The small count after a tab's label. */
export const tabCountClasses =
  "num ml-2 text-2xs font-medium tracking-normal text-muted normal-case";
