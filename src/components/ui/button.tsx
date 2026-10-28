import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "border-ink bg-ink text-white hover:border-ink-2 hover:bg-ink-2",
  secondary: "border-line-input bg-surface text-ink hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-line-soft",
  danger: "border-red bg-surface text-red hover:bg-red-tint",
};

/**
 * Button classes, for when something that isn't a <button> (like a Next.js
 * <Link>) should look like one: <Link className={buttonClasses("primary")}>.
 */
export function buttonClasses(variant: ButtonVariant = "secondary") {
  return cn(
    "inline-flex h-[var(--height-control)] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm border px-3.5 text-base font-medium whitespace-nowrap no-underline transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    variants[variant],
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Optional leading icon, shown at 15px. */
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  icon,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses(variant), className)}
      {...props}
    >
      {icon && (
        <span className="inline-flex size-[15px] shrink-0 items-center justify-center [&>svg]:size-[15px]">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
