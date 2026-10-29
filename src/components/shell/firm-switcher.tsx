"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { MyFirm } from "@/server/firms/my-firms";
import {
  HeaderMenu,
  HeaderMenuContent,
  HeaderMenuLabel,
  HeaderMenuRadioGroup,
  HeaderMenuRadioItem,
  HeaderMenuTrigger,
} from "./header-menu";
import { SHELL_ICONS, iconProps } from "./icons";

type FirmProps = { name: string; logoUrl: string | null };

function FirmTile({ name, logoUrl }: FirmProps) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-canvas text-xs font-bold text-ink"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

function FirmName({ name }: { name: string }) {
  return (
    <span
      data-testid="firm-name"
      className="max-w-[140px] truncate font-semibold md:max-w-[320px]"
    >
      {name}
    </span>
  );
}

type FirmSwitcherProps = FirmProps & {
  /** Every firm I'm an active member of (loaded on the server). */
  firms: MyFirm[];
};

/**
 * The firm at the left of the header. With one firm it's just the name.
 * With more it's a menu: picking a firm makes it active in Clerk and reloads
 * the app for it.
 */
export function FirmSwitcher({ name, logoUrl, firms }: FirmSwitcherProps) {
  const { setActive, loaded } = useClerk();
  const router = useRouter();
  const [switching, startSwitching] = useTransition();

  if (firms.length <= 1) {
    return (
      <div className="flex h-9 max-w-full items-center gap-2.5 pr-2.5 pl-1 text-chrome-text">
        <FirmTile name={name} logoUrl={logoUrl} />
        <FirmName name={name} />
      </div>
    );
  }

  function pick(firm: MyFirm) {
    if (firm.current) return;
    startSwitching(async () => {
      try {
        await setActive({ organization: firm.clerkOrgId });
      } catch (err) {
        // Stay on the current firm rather than crashing the page.
        console.error("Couldn't switch firm", err);
        return;
      }
      router.push("/app");
      router.refresh();
    });
  }

  return (
    <HeaderMenu>
      {/* Disabled until Clerk has loaded in the browser: switching before
          then crashed the page ("This page couldn't load"). */}
      <HeaderMenuTrigger
        disabled={!loaded}
        aria-busy={switching || !loaded || undefined}
        className="flex h-9 max-w-full cursor-pointer items-center gap-2.5 rounded-sm border border-chrome-line bg-transparent pr-2.5 pl-1 text-chrome-text hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-white"
      >
        <FirmTile name={name} logoUrl={logoUrl} />
        <FirmName name={name} />
        <svg {...iconProps(14, 2.25)} className="shrink-0">
          <path d={SHELL_ICONS.chevronDown} />
        </svg>
      </HeaderMenuTrigger>
      <HeaderMenuContent label="Switch firm">
        <HeaderMenuLabel>Your firms</HeaderMenuLabel>
        <HeaderMenuRadioGroup value={firms.find((f) => f.current)?.clerkOrgId}>
          {firms.map((f) => (
            <HeaderMenuRadioItem
              key={f.clerkOrgId}
              value={f.clerkOrgId}
              onSelect={() => pick(f)}
            >
              <FirmTile name={f.name} logoUrl={f.logoUrl} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            </HeaderMenuRadioItem>
          ))}
        </HeaderMenuRadioGroup>
      </HeaderMenuContent>
    </HeaderMenu>
  );
}
