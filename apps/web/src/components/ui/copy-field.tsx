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
  className,
}: {
  label: string;
  value: string;
  /** The button's text before copying, e.g. "Copy link". */
  copyLabel?: string;
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
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="data h-8 min-w-0 flex-1 rounded-md border border-line-control bg-field px-2.5 text-fg focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
        />
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
