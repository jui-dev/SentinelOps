/**
 * An activity indicator with its words. With reduced motion requested it
 * stands still; the label still says what is happening.
 */
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
      <span
        aria-hidden="true"
        className="size-3.5 rounded-full border-[1.5px] border-line-strong border-t-accent motion-safe:animate-spin"
      />
      <span>{label}</span>
    </div>
  );
}

/**
 * A spinner centred in the view, for whole-view loading. `panel` sizes it to
 * the sign-in panel's usual content, so the panel does not grow and then
 * collapse when the form arrives.
 */
export function PageSpinner({
  label,
  size = "view",
}: {
  label?: string;
  size?: "view" | "panel";
}) {
  return (
    <div
      className={
        size === "panel"
          ? "flex h-72 items-center justify-center"
          : "flex min-h-[50vh] items-center justify-center"
      }
    >
      <Spinner label={label} />
    </div>
  );
}

/**
 * A list on its way: its frame, already the height a few rows take, with
 * faint rows where the rows will be and the spinner's words above them —
 * so nothing below it moves when the list arrives.
 */
export function ListLoading({
  label = "Loading…",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Spinner label={label} />
      <div
        aria-hidden="true"
        className="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-surface"
      >
        <div className="h-10 bg-thead" />
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-12 items-center gap-4 px-4">
            <span className="h-2.5 w-1/4 rounded-full bg-line-subtle motion-safe:animate-pulse" />
            <span className="h-2.5 w-1/6 rounded-full bg-line-subtle motion-safe:animate-pulse" />
            <span className="ml-auto h-2.5 w-16 rounded-full bg-line-subtle motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
