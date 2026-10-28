"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";

/**
 * Dialog and Drawer, built on Radix (focus is trapped, Esc closes).
 *
 * <Dialog>
 *   <DialogTrigger asChild><Button>Edit</Button></DialogTrigger>
 *   <DialogContent title="Edit phase" footer={<>…buttons…</>}>…</DialogContent>
 * </Dialog>
 *
 * For a panel that slides in from the right, use <DrawerContent> instead.
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

type ContentProps = {
  title: ReactNode;
  /** One-line explanation under the title (also read by screen readers). */
  description?: ReactNode;
  /** Actions, right-aligned. Put the primary action last. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function Overlay() {
  return <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />;
}

function Header({
  title,
  description,
}: Pick<ContentProps, "title" | "description">) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <RadixDialog.Title className="cap m-0 text-sm font-semibold">
          {title}
        </RadixDialog.Title>
        {description && (
          <RadixDialog.Description className="m-0 text-sm text-muted">
            {description}
          </RadixDialog.Description>
        )}
      </div>
      <RadixDialog.Close
        aria-label="Close"
        className="-mt-1 -mr-2 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
      >
        <CloseIcon />
      </RadixDialog.Close>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-5 py-3.5">
      {children}
    </div>
  );
}

/** Without a description, tell Radix we chose not to have one (stops a console warning). */
function describedBy(description: ReactNode) {
  return description ? {} : { "aria-describedby": undefined };
}

export function DialogContent({
  title,
  description,
  footer,
  children,
  className,
}: ContentProps) {
  return (
    <RadixDialog.Portal>
      <Overlay />
      <RadixDialog.Content
        {...describedBy(description)}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-sm border border-line bg-surface text-ink focus:outline-none",
          className,
        )}
      >
        <Header title={title} description={description} />
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <Footer>{footer}</Footer>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DrawerContent({
  title,
  description,
  footer,
  children,
  className,
}: ContentProps) {
  return (
    <RadixDialog.Portal>
      <Overlay />
      <RadixDialog.Content
        {...describedBy(description)}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-line bg-surface text-ink focus:outline-none",
          className,
        )}
      >
        <Header title={title} description={description} />
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <Footer>{footer}</Footer>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
