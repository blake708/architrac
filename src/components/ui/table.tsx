import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Data table with real <table> markup. Mark money, hours and other numbers
 * with `numeric` so they right-align in the mono font.
 */
export function Table({
  className,
  wrapperClassName,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn("overflow-x-auto", wrapperClassName)}>
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-2", className)} {...props} />;
}

/** Body rows get a soft divider and a hover background. */
export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        "[&>tr]:border-b [&>tr]:border-line-soft [&>tr:hover]:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

/** Totals row(s). */
export function TableFoot({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn("bg-surface-2 font-semibold", className)}
      {...props}
    />
  );
}

export function TableRow(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

type Numeric = { numeric?: boolean };

/** Column header. Uppercase comes from the base styles. */
export function TableHeader({
  numeric,
  className,
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & Numeric) {
  return (
    <th
      scope={scope}
      className={cn(
        "border-b border-line px-2.5 py-2.5 text-2xs font-medium whitespace-nowrap text-muted first:pl-[18px] last:pr-[18px]",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  numeric,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & Numeric) {
  return (
    <td
      className={cn(
        "px-2.5 py-2.5 align-middle first:pl-[18px] last:pr-[18px]",
        numeric && "num text-right text-[12.5px] whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
