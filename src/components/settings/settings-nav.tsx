"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { sectionForPath, settingsGroups } from "@/lib/settings/sections";
import { DISCARD_MESSAGE, useSettingsFormStatus } from "./form-state";

/**
 * The Settings section menu (settings-firm spec, Layout §2). Leaving a
 * section with unsaved changes asks "Discard unsaved changes?" first.
 */
export function SettingsNav() {
  const current = sectionForPath(usePathname());
  const { form } = useSettingsFormStatus();

  return (
    <nav
      aria-label="Settings sections"
      className="max-w-[260px] min-w-0 flex-[1_1_220px] py-7 pl-4 md:pl-page-x"
    >
      {settingsGroups().map((g) => (
        <div key={g.name} className="mb-[22px] last:mb-0">
          <div className="cap pb-2 text-2xs font-semibold text-muted">
            {g.name}
          </div>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {g.items.map((s) => {
              const isCurrent = current?.key === s.key;
              return (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={(e) => {
                      if (
                        !isCurrent &&
                        form?.dirty &&
                        !window.confirm(DISCARD_MESSAGE)
                      ) {
                        e.preventDefault();
                      }
                    }}
                    className={cn(
                      "block rounded-sm px-3 py-[9px] text-base no-underline",
                      "focus-visible:outline-2 focus-visible:outline-blue",
                      isCurrent
                        ? "bg-surface font-semibold text-ink shadow-[inset_3px_0_0_var(--color-ink),0_1px_2px_rgba(20,20,20,.08)]"
                        : "font-medium text-ink-2 hover:bg-line-soft",
                    )}
                  >
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
