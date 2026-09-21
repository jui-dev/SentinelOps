import type { ButtonHTMLAttributes, ComponentType, SVGProps } from "react";

import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  // Navy fill; a muted 1px edge carries its boundary on the dark
  // workspace (and shows in forced-colours mode, where the fill is
  // removed). A faint top light gives it body; pressed, it sinks.
  primary:
    "border border-accent-rim bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_-1px_0_rgb(0_0_0/0.25)] hover:bg-accent-hover active:bg-accent-pressed active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] disabled:border-transparent disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none",
  secondary:
    "border border-line-strong bg-surface text-fg shadow-control hover:border-line-control hover:bg-hover active:bg-sunken disabled:border-line disabled:bg-surface disabled:text-fg-disabled disabled:shadow-none",
  quiet:
    "text-fg-muted hover:bg-hover hover:text-fg active:bg-sunken disabled:bg-transparent disabled:text-fg-disabled",
  // Outlined on purpose: in a dense table a solid red block shouts. A solid
  // treatment is for high-consequence confirmations, when those exist.
  destructive:
    "border border-danger-line bg-field text-danger-text hover:border-danger-solid hover:bg-danger-subtle active:bg-danger-subtle disabled:border-line disabled:text-fg-disabled disabled:bg-field",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-4 text-base",
};

/**
 * The classes for a button of this variant and size, for elements that must
 * look like a button but are not one — a Next.js <Link>, most often.
 */
export const buttonClasses = ({
  variant = "primary",
  size = "md",
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string =>
  cx(base, variants[variant], sizes[size]);

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A leading icon, decorative: the button's text is its name. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <button
      type={type}
      className={cx(buttonClasses({ variant, size }), className)}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      {children}
    </button>
  );
}
