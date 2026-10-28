import { cn } from "@/lib/cn";
import { initials } from "@/lib/initials";

type AvatarProps = {
  /** Full name; shown as initials and as the hover title. */
  name: string;
  /** sm = 28px (tables), md = 32px (header). */
  size?: "sm" | "md";
  className?: string;
};

const sizes = { sm: "size-7", md: "size-8" };

export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-ink-2 text-2xs font-semibold text-white select-none",
        sizes[size],
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}
