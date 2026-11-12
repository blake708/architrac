import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { InvoiceStatus } from "@/lib/calc/invoice";
import { cn } from "@/lib/cn";

// Small pieces shared by the invoice pages.

const STATUS: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "blue" },
  sent: { label: "Sent", tone: "orange" },
  partially_paid: { label: "Partially paid", tone: "orange" },
  paid: { label: "Paid", tone: "green" },
  void: { label: "Void", tone: "neutral" },
  written_off: { label: "Written off", tone: "neutral" },
};

export const statusLabel = (s: InvoiceStatus) => STATUS[s].label;

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge tone={STATUS[status].tone} dot>
      {STATUS[status].label}
    </Badge>
  );
}

/** A warning line (Layout C.3): orange for "look at this", red for "this is wrong". */
export function Callout({ tone, children }: { tone: "attention" | "danger"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-sm border px-3.5 py-2.5 text-sm",
        tone === "danger" ? "border-red/30 bg-red-tint text-red" : "border-orange/30 bg-orange-tint text-orange-strong",
      )}
    >
      {children}
    </div>
  );
}
