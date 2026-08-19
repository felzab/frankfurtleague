/**
 * Deliberately a different shape from `PageLoader`'s ringed spinner, so the two are tellable at a glance: that one means
 * a whole page is loading, this that the shell is painted and only the content region is streaming.
 */
export function ContentLoader() {
  return (
    <div
      role="status"
      aria-label="Inhalte werden geladen"
      className="flex w-full flex-1 items-center justify-center gap-x-1.5 px-4 py-16">
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.4s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.2s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full" />
    </div>
  );
}
