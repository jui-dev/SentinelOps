import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { SectionIcon } from "@/components/overview/overview-panel";

import { cx } from "./cx";

/**
 * One setting, in the sections' frame the rest of the workspace uses: what
 * it is and what changing it does on the left, beneath its icon, and the
 * control on an inner panel of its own on the right. Spacious on purpose —
 * settings are rarely urgent.
 */
export function SettingRow({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 rounded-lg border border-section-line bg-section-ground p-4 shadow-card sm:p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div className="flex items-start gap-3">
        {icon && <SectionIcon icon={icon} family="setup" />}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg leading-6 font-semibold tracking-[-0.01em] text-fg">
            {title}
          </h2>
          <div className="text-sm text-fg-muted">{description}</div>
        </div>
      </div>
      <div className={cx(INSTRUMENT, "min-w-0 px-4 py-4 sm:px-5")}>{children}</div>
    </section>
  );
}
