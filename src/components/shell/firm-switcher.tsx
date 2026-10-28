"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MyFirm } from "@/server/firms/my-firms";
import { listMyFirms } from "@/server/firms/actions";
import {
  HeaderMenu,
  HeaderMenuContent,
  HeaderMenuLabel,
  HeaderMenuRadioGroup,
  HeaderMenuRadioItem,
  HeaderMenuTrigger,
} from "./header-menu";
import { SHELL_ICONS, iconProps } from "./icons";

type FirmSwitcherProps = { name: string; logoUrl: string | null };

function FirmTile({ name, logoUrl }: FirmSwitcherProps) {
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

/**
 * The firm button at the left of the header. Opening it loads the firms I
 * belong to; picking one makes it active in Clerk and reloads the app for it.
 */
export function FirmSwitcher({ name, logoUrl }: FirmSwitcherProps) {
  const { setActive } = useClerk();
  const router = useRouter();
  const [firms, setFirms] = useState<MyFirm[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, startLoading] = useTransition();
  const [switching, startSwitching] = useTransition();

  function onOpenChange(open: boolean) {
    if (!open || firms) return;
    setFailed(false);
    startLoading(async () => {
      try {
        setFirms(await listMyFirms());
      } catch {
        setFailed(true);
      }
    });
  }

  function pick(firm: MyFirm) {
    if (firm.current) return;
    startSwitching(async () => {
      await setActive({ organization: firm.clerkOrgId });
      setFirms(null); // the list's check mark moves; load it fresh next time
      router.push("/app");
      router.refresh();
    });
  }

  return (
    <HeaderMenu onOpenChange={onOpenChange}>
      <HeaderMenuTrigger
        aria-busy={switching || undefined}
        className="flex h-9 max-w-full cursor-pointer items-center gap-2.5 rounded-sm border border-chrome-line bg-transparent pr-2.5 pl-1 text-chrome-text hover:bg-chrome-2 focus-visible:outline-2 focus-visible:outline-white"
      >
        <FirmTile name={name} logoUrl={logoUrl} />
        <span
          data-testid="firm-name"
          className="max-w-[140px] truncate font-semibold md:max-w-[320px]"
        >
          {name}
        </span>
        <svg {...iconProps(14, 2.25)} className="shrink-0">
          <path d={SHELL_ICONS.chevronDown} />
        </svg>
      </HeaderMenuTrigger>
      <HeaderMenuContent label="Switch firm">
        <HeaderMenuLabel>Your firms</HeaderMenuLabel>
        {(loading || (!firms && !failed)) && (
          <p className="m-0 px-2.5 py-2 text-sm text-muted">Loading firms…</p>
        )}
        {failed && (
          <p className="m-0 px-2.5 py-2 text-sm text-red">
            Couldn&apos;t load your firms. Close this menu and try again.
          </p>
        )}
        {!loading && firms && (
          <HeaderMenuRadioGroup
            value={firms.find((f) => f.current)?.clerkOrgId}
          >
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
        )}
      </HeaderMenuContent>
    </HeaderMenu>
  );
}
