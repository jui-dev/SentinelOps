export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-slate-600">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900"
      />
      <span>{label}</span>
    </div>
  );
}

/** A spinner centred in the page, for whole-view loading. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
