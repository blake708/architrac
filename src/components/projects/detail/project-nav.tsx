"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { headerTabBarClasses, tabClasses, tabRowClasses } from "@/components/ui/tab-styles";

/**
 * The project's tabs (project-detail spec, Layout 3). Each tab is a link, so
 * it can be bookmarked. Tabs for later releases aren't shown at all.
 */
export const projectTabs = [
  { label: "Overview", segment: "", financialOnly: false },
  { label: "Phases & fees", segment: "/phases", financialOnly: true },
  { label: "Team", segment: "/team", financialOnly: false },
  { label: "Invoices", segment: "/billing", financialOnly: true },
] as const;

export function ProjectNav({ projectId, financial }: { projectId: string; financial: boolean }) {
  const path = usePathname();
  const base = `/app/projects/${projectId}`;
  return (
    <nav aria-label="Project sections" className={headerTabBarClasses}>
      <ul className={tabRowClasses}>
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
                  className={tabClasses(current)}
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
