"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FLASH_COOKIE, takeFlash } from "@/lib/flash/flash";
import { useToast } from "./toast";

/** Shows a message left by the previous page's server action, once. */
export function FlashToast() {
  const toast = useToast();
  const path = usePathname();
  useEffect(() => {
    const message = takeFlash(document.cookie);
    if (!message) return;
    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    toast(message);
  }, [path, toast]);
  return null;
}
