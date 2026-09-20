import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { quietLinkClasses } from "./link";

/**
 * "Go to the whole of it": a quiet link with a trailing arrow, for a page
 * that continues what is on screen — the full list behind a preview, or the
 * history behind the state now. Never a call to action; the page's own
 * buttons are for that.
 */
export function OnwardLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1.5 text-sm text-fg-muted ${quietLinkClasses}`}
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 text-fg-subtle group-hover:text-accent-text"
      />
    </Link>
  );
}
