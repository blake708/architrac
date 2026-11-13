"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Underline tabs. Radix handles the keyboard (arrow keys move between tabs).
 *
 * <Tabs defaultValue="active">
 *   <TabsList aria-label="Project status">
 *     <TabsTrigger value="active" count={12}>Active</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="active">…</TabsContent>
 * </Tabs>
 */
export const Tabs = RadixTabs.Root;

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn(
        "flex gap-1.5 overflow-x-auto border-b border-line-soft",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  count,
  children,
  ...props
}: ComponentProps<typeof RadixTabs.Trigger> & {
  /** Optional mono count after the label. */
  count?: ReactNode;
}) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "cap inline-flex h-[50px] shrink-0 cursor-pointer items-center border-0 bg-transparent px-3 text-[12.5px] font-medium tracking-[0.07em] whitespace-nowrap text-ink-3",
        "hover:text-ink data-[state=active]:font-bold data-[state=active]:text-ink data-[state=active]:shadow-[inset_0_-3px_0_var(--color-ink)]",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue",
        "disabled:cursor-not-allowed disabled:text-faint",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="num ml-2 text-2xs font-medium tracking-normal text-muted normal-case">
          {count}
        </span>
      )}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content
      className={cn(
        "pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
        className,
      )}
      {...props}
    />
  );
}
