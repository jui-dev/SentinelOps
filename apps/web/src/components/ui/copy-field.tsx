"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "./button";
import { cx } from "./cx";

/**
 * A read-only value to hand on — a link, a key — with a Copy button. The
 * value selects itself on focus, so copying by hand works when the
 * clipboard API does not.
 */
export function CopyField({
  label,
  value,
  copyLabel = "Copy",
  multiline = false,
  className,
}: {
  label: string;
  value: string;
  /** The button's text before copying, e.g. "Copy link". */
  copyLabel?: string;
  /** Prose rather than a key: several lines, in the reading face. */
  multiline?: boolean;
  className?: string;
}) {
  const id = useId();
  const [copied, setCopied] = useState<boolean | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className={cx("flex gap-2", multiline && "flex-col items-start")}>
        {multiline ? (
          <textarea
            id={id}
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            className="field-sizing-content min-h-16 w-full min-w-0 resize-none rounded-md border border-line-control bg-field px-2.5 py-1.5 text-base leading-6 text-fg focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
        ) : (
          <input
            id={id}
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            className="data h-8 min-w-0 flex-1 rounded-md border border-line-control bg-field px-2.5 text-fg focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
        )}
        <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Copied" : copyLabel}
        </Button>
      </div>
      {copied === false && (
        <p className="text-xs text-fg-muted">
          Copying failed. Select the value and copy it manually.
        </p>
      )}
    </div>
  );
}
