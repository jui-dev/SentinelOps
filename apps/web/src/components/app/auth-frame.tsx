import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

import { StripFrame } from "./situation";
import { AppearanceMenu } from "./shell-utilities";

const widths = { sm: "max-w-sm", md: "max-w-md", wide: "max-w-[55rem]" };

/**
 * The frame for pages outside the workspace — sign-in, registration, and
 * invitation acceptance. The same ink strip as the workspace, so the product
 * is recognisably itself before anyone signs in, and one panel for the task.
 *
 * `wide` is for a page that draws its own card — the login page, with the
 * demo accounts beside its form — and gets the room without the shared card.
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
      {/* A wide page names the product itself, above its card. */}
      <StripFrame
        trailing={<AppearanceMenu />}
        wordmark={width !== "wide"}
      />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:pb-24">
        <div className={cx("flex w-full flex-col gap-4", widths[width])}>
          {width === "wide" ? (
            children
          ) : (
            <>
              <div className="rounded-lg border border-line bg-surface px-5 py-6 sm:px-7 sm:py-7">
                {children}
              </div>
              <p className="text-center text-xs text-fg-subtle">
                Incident &amp; operations management
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
