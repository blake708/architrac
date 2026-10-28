"use client";

import { useOrganizationList } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Selects the person's first firm (by name) in Clerk, then opens the app. */
export function ChooseFirm() {
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || userMemberships.isLoading || started.current) return;
    const orgs = [...(userMemberships.data ?? [])]
      .map((m) => m.organization)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (orgs.length === 0) {
      router.replace("/onboarding/create-firm");
      return;
    }
    started.current = true;
    void setActive({ organization: orgs[0].id }).then(() => {
      router.replace("/app");
      router.refresh();
    });
  }, [isLoaded, setActive, userMemberships, router]);

  return <p className="text-sm text-ink-3">Opening your firm…</p>;
}
