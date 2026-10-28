"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  HeaderMenu,
  HeaderMenuContent,
  HeaderMenuItem,
  HeaderMenuSeparator,
  HeaderMenuTrigger,
} from "./header-menu";

type AccountMenuProps = {
  name: string;
  email: string;
  roleLabel: string;
  initials: string;
  avatarUrl: string | null;
};

/** The avatar at the right of the header and its menu. */
export function AccountMenu({
  name,
  email,
  roleLabel,
  initials,
  avatarUrl,
}: AccountMenuProps) {
  const { signOut } = useClerk();

  return (
    <HeaderMenu>
      <HeaderMenuTrigger
        aria-label="Account menu"
        className="inline-flex cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <Avatar name={name} initials={initials} src={avatarUrl} />
      </HeaderMenuTrigger>
      <HeaderMenuContent label="Account" align="end">
        <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-2.5">
          <span className="font-semibold">{name}</span>
          <span className="text-sm text-muted">{email}</span>
          <span className="cap mt-1 text-2xs font-semibold text-ink-3">
            {roleLabel}
          </span>
        </div>
        <HeaderMenuSeparator />
        <HeaderMenuItem asChild>
          <Link href="/app/account">Your account</Link>
        </HeaderMenuItem>
        <HeaderMenuItem
          onSelect={() => void signOut({ redirectUrl: "/sign-in" })}
        >
          Sign out
        </HeaderMenuItem>
      </HeaderMenuContent>
    </HeaderMenu>
  );
}
