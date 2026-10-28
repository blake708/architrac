/** Red banner at the top of Main when a save fails (settings-firm spec, States). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-sm border border-red/30 bg-red-tint px-4 py-3 text-sm text-red"
    >
      {message}
    </div>
  );
}
