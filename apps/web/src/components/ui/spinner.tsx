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
