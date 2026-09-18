import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

import { StripFrame } from "./situation";
import { ThemeControl } from "./theme-control";

const widths = { sm: "max-w-sm", md: "max-w-md" };

/**
 * The frame for pages outside the workspace — sign-in, registration, and
 * invitation acceptance. The same ink strip as the workspace, so the product
 * is recognisably itself before anyone signs in, and one panel for the task.
 */
export function AuthFrame({
  width = "sm",
  children,
}: {
  width?: keyof typeof widths;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <StripFrame trailing={<ThemeControl />} />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:pb-24">
        <div className={cx("flex w-full flex-col gap-4", widths[width])}>
          <div className="rounded-lg border border-line bg-surface px-5 py-6 sm:px-7 sm:py-7">
            {children}
          </div>
          <p className="text-center text-xs text-fg-subtle">
            Incident &amp; operations management
          </p>
        </div>
      </main>
    </div>
  );
}
