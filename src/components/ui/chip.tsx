import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";

/**
 * A small removable tag (settings-rates-phases spec, "Chip"): an activity or
 * leave type in a list. `removeLabel` names the × button for screen readers.
 */
export function Chip({
  label,
  onRemove,
  removeLabel,
  className,
}: {
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface-2 pr-1 pl-2.5 text-sm",
        !onRemove && "pr-2.5",
        className,
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `Remove ${label}`}
          className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-blue"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
