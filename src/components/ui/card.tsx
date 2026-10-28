import { useId } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** Uppercase title in the card header. */
  title?: ReactNode;
  /** Short muted note next to the title. */
  description?: ReactNode;
  /** Buttons or links on the right of the header. */
  actions?: ReactNode;
  /** Set false when the body is a full-bleed table. */
  padded?: boolean;
};

export function Card({
  title,
  description,
  actions,
  padded = true,
  className,
  children,
  ...props
}: CardProps) {
  const titleId = useId();
  const hasHeader = Boolean(title || actions);
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("rounded-sm border border-line bg-surface", className)}
      {...props}
    >
      {hasHeader && (
        <header className="flex min-h-[38px] flex-wrap items-center gap-x-3 gap-y-2 px-[var(--spacing-card)] pt-4 pb-3">
          {title && (
            <h2 id={titleId} className="m-0 text-sm font-semibold">
              {title}
            </h2>
          )}
          {description && (
            <span className="text-[12.5px] text-muted">{description}</span>
          )}
          {actions && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>
      )}
      <div
        className={cn(
          padded && "px-[var(--spacing-card)] pb-[var(--spacing-card)]",
          padded && !hasHeader && "pt-[var(--spacing-card)]",
        )}
      >
        {children}
      </div>
    </section>
  );
}
