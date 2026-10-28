/** Joins class names, skipping empty ones: cn("a", cond && "b") → "a b". */
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
