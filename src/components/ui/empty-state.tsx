import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type EmptyStateProps = {
  /** One line: what's missing. "No projects yet" */
  title: ReactNode;
  /** One line: what to do about it. */
  help?: ReactNode;
  /** One primary action, usually a Button. */
  action?: ReactNode;
  className?: string;
};

/** Place inside a Card when there's nothing to show. */
export function EmptyState({
  title,
  help,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="m-0 font-semibold">{title}</p>
      {help && <p className="m-0 text-sm text-muted">{help}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
