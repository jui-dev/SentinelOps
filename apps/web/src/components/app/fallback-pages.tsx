"use client";

import {
  House,
  RotateCcw,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * What every fallback page says, wherever it is drawn — in the sign-in
 * frame, or in the workspace's body with its rail still beside it. A page
 * heading, one line on what happened, and the ways on.
 */

const eyebrow = "label-caps text-fg-subtle";

/** A URL that names no page. */
export function NotFoundContent() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className={eyebrow}>404</p>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">
          Page not found
        </h1>
        <p className="text-sm text-fg-muted">
          There is no page at this address. The link may be old, or mistyped.
        </p>
      </div>
      <div>
        {/* "/" sends each person to where they work. */}
        <ButtonLink href="/" variant="primary" icon={House}>
          Go to your workspace
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * An error nothing else caught. Logged to the console for whoever is
 * debugging; the person reading is offered another try, a way out, and —
 * when the server gave one — a reference to quote. The error's own message
 * is never shown: from the server it is withheld anyway, and from the
 * browser it is meant for developers.
 */
export function ErrorContent({
  error,
  retry,
  headingLevel = 1,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** 2 inside a page that already has its own heading. */
  headingLevel?: 1 | 2;
}) {
  const Heading = `h${headingLevel}` as const;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className={eyebrow}>Unexpected error</p>
        <Heading className="text-xl font-semibold tracking-[-0.01em] text-fg">
          Something went wrong
        </Heading>
        <p className="text-sm text-fg-muted">
          This page stopped because of an error on our side. Trying again
          often works.
        </p>
        {error.digest && (
          <p className="pt-1 text-xs text-fg-subtle">
            Reference <span className="data select-all">{error.digest}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={RotateCcw} onClick={() => retry()}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary" icon={House}>
          Go to your workspace
        </ButtonLink>
      </div>
    </div>
  );
}
