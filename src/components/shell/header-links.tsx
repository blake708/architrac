"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isCurrent, titleForPath } from "@/lib/shell/nav";
import { SHELL_ICONS, iconProps } from "./icons";

/** Settings gear. Only rendered for owner/admin (decided on the server). */
export function SettingsGear() {
  const current = isCurrent(usePathname(), "/app/settings");
  return (
    <Link
      href="/app/settings"
      aria-label="Settings"
      title="Settings"
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex size-[34px] items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-white",
        current
          ? "bg-chrome-2 text-white shadow-[inset_0_-2px_0_#FFFFFF]"
          : "text-chrome-muted hover:text-white",
      )}
    >
      <svg {...iconProps(18, 2)}>
        <path d={SHELL_ICONS.settings} />
      </svg>
    </Link>
  );
}

type PageTitleProps = {
  title: string;
  /** Breadcrumb parent shown before the title: "Projects / …" */
  parent?: { label: string; href: string };
};

/** The page name in the header, with an optional breadcrumb parent. */
export function PageTitle({ title, parent }: PageTitleProps) {
  return (
    <span className="cap min-w-0 font-medium text-chrome-text">
      {parent && (
        <>
          <Link
            href={parent.href}
            className="text-chrome-muted no-underline hover:text-white"
          >
            {parent.label}
          </Link>
          <span className="text-chrome-muted"> / </span>
        </>
      )}
      {title}
    </span>
  );
}

/**
 * The header title for the current page, worked out from its address.
 * Pages that need a data-driven title (a project's name) will pass one
 * through a header slot when they're built in Release 1.
 */
export function CurrentPageTitle() {
  const title = titleForPath(usePathname());
  return title ? <PageTitle title={title} /> : null;
}
