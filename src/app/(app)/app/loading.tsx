// Shown while a page loads. The rail and header stay put; only the page area
// shows grey placeholder bars.
export default function AppLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="border-b border-line bg-surface"
    >
      <div className="flex flex-col gap-3 px-4 pt-8 pb-7 md:px-page-x">
        <span className="block h-3 w-40 rounded-sm bg-line-soft" />
        <span className="block h-8 w-72 max-w-full rounded-sm bg-line-soft" />
      </div>
    </div>
  );
}
