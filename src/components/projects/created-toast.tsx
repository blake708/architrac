"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { PROJECT_MESSAGES } from "@/lib/projects/form";

/** Shows "Project 2026-023 created" after New project, then tidies the address. */
export function CreatedToast({ number }: { number: string | null }) {
  const toast = useToast();
  useEffect(() => {
    if (!number) return;
    toast(PROJECT_MESSAGES.created(number));
    window.history.replaceState(null, "", window.location.pathname);
  }, [number, toast]);
  return null;
}
