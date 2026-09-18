import type { ReactNode } from "react";

/**
 * One setting: what it is and what changing it does on the left, the control
 * on the right. Spacious on purpose — settings are rarely urgent.
 */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    // A soft rule between rows pairs each description with its control
    // across the two columns; the first row needs none.
    <section className="grid gap-x-10 gap-y-4 border-t border-line-subtle py-6 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <h2 className="text-[0.9375rem] leading-6 font-semibold text-fg">
          {title}
        </h2>
        <div className="text-sm text-fg-muted">{description}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
