"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The project's tabs (project-detail spec, Layout 3). Each tab is a link, so
 * it can be bookmarked. Tabs for later releases aren't shown at all.
 */
export const projectTabs = [
  { label: "Overview", segment: "", financialOnly: false },
  { label: "Phases & fees", segment: "/phases", financialOnly: true },
  { label: "Team", segment: "/team", financialOnly: false },
] as const;

export function ProjectNav({ projectId, financial }: { projectId: string; financial: boolean }) {
  const path = usePathname();
  const base = `/app/projects/${projectId}`;
  return (
    <nav aria-label="Project sections" className="border-b border-line bg-surface px-4 md:px-page-x">
      <ul className="m-0 flex list-none gap-6 overflow-x-auto p-0">
        {projectTabs
          .filter((t) => financial || !t.financialOnly)
          .map((t) => {
            const href = base + t.segment;
            const current = path === href;
            return (
              <li key={t.label}>
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "-mb-px block border-b-2 px-1 pt-3 pb-2.5 text-base whitespace-nowrap no-underline",
                    current ? "border-ink font-semibold text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
