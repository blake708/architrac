import { cn } from "@/lib/cn";
import { initials as initialsFrom } from "@/lib/initials";

type AvatarProps = {
  /** Full name; shown as initials and as the hover title. */
  name: string;
  /** Stored initials (users.initials). Worked out from the name if missing. */
  initials?: string;
  /** Photo (users.avatar_url). Shown instead of initials when set. */
  src?: string | null;
  /** sm = 28px (tables), md = 32px (header). */
  size?: "sm" | "md";
  className?: string;
};

const sizes = { sm: "size-7", md: "size-8" };

export function Avatar({
  name,
  initials,
  src,
  size = "md",
  className,
}: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-2 text-2xs font-semibold text-white select-none",
        sizes[size],
        className,
      )}
    >
      {src ? (
        // A small remote photo from Clerk; next/image would need its domain configured.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials || initialsFrom(name)}</span>
      )}
    </span>
  );
}
