// While a settings section loads, the header band and section menu stay put
// (they're in the layout); Main shows a grey card.
export default function SettingsLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-4 rounded-sm border border-line bg-surface px-6 py-6"
    >
      <span className="block h-3 w-32 rounded-sm bg-line-soft" />
      <span className="block h-9 w-full max-w-[480px] rounded-sm bg-line-soft" />
      <span className="block h-9 w-full max-w-[480px] rounded-sm bg-line-soft" />
      <span className="block h-9 w-full max-w-[320px] rounded-sm bg-line-soft" />
    </div>
  );
}
