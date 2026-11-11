/** One field of a worked example. `half` shares its row with the next one. */
export interface FormExampleField {
  label: string;
  value: string;
  half?: boolean;
}

/**
 * A finished example of what a form asks for, opened only by whoever wants
 * it, so the form stays short for everyone else. It is read-only text:
 * nothing in it is entered into the form or saved.
 */
export function FormExample({ fields }: { fields: readonly FormExampleField[] }) {
  return (
    <details className="group rounded-lg border border-status-investigating-line bg-status-investigating-subtle">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        Not sure what to write? See a good example
        <span aria-hidden="true" className="shrink-0 text-xs font-medium text-fg-muted">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="flex flex-col gap-2.5 px-3.5 pt-0.5 pb-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {fields.map((field) => (
            <div key={field.label} className={field.half ? "min-w-0" : "col-span-2 min-w-0"}>
              <dt className="label-caps text-fg-muted">{field.label}</dt>
              <dd className="text-sm leading-5 text-fg">{field.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-fg-muted">Only an example. Nothing here is saved.</p>
      </div>
    </details>
  );
}
