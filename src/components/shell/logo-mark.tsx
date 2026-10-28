/** The ArchiTrac house icon + wordmark. Colour comes from the parent (currentColor). */
export function LogoMark({ showWord = true }: { showWord?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M3 20h18" />
        <path d="M5 20V9l7-5 7 5v11" />
        <path d="M9 20v-6h6v6" />
      </svg>
      {showWord && (
        <span className="text-[13px] font-bold tracking-[0.16em]">
          ARCHITRAC
        </span>
      )}
    </span>
  );
}
