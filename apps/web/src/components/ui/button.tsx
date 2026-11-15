import type {
  ButtonHTMLAttributes,
  ComponentType,
  ReactNode,
  SVGProps,
} from "react";

import { cx } from "./cx";

/**
 * What a button does decides its colour — never the page it is on — so a
 * colour learnt once means the same thing everywhere:
 *
 * - `primary`  navy, filled: the one way forward on a page or dialog —
 *   Save, Create, Declare, Resolve, Done, Try again. One per surface.
 * - `complete` teal, filled: finishing one's own work on an incident.
 * - `view`     blue: look without changing — View, Details, Open.
 * - `edit`     amber: change something that exists — Edit, Change role.
 * - `add`      green: put something in — Add, New, Keep.
 * - `manage`   violet: open a set of choices about one thing.
 * - `restore`  cyan: bring something back — Restore, Unarchive.
 * - `destructive` red, outlined: take something away — Delete, Remove,
 *   Archive. Opens its confirmation.
 * - `danger`   red, filled: only the final "are you sure" of a removal.
 * - `secondary` grey: back out or housekeeping — Cancel, Close, Reset
 *   password.
 * - `quiet`    no box: small helpers beside a list — Clear filters.
 *
 * Every button carries an icon as well as its words, so colour is never the
 * only clue.
 */
export type ButtonVariant =
  | "primary"
  | "complete"
  | "view"
  | "edit"
  | "add"
  | "manage"
  | "restore"
  | "destructive"
  | "danger"
  | "secondary"
  | "quiet";

/** `sm` (28 px) for table rows and filter bars; `md` (32 px) elsewhere. */
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed";

/** Disabled looks the same for every kind: grey, its colour gone. */
const disabledOutlined =
  "disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none";

const variants: Record<ButtonVariant, string> = {
  // Navy fill; a muted 1px edge carries its boundary on the dark
  // workspace (and shows in forced-colours mode, where the fill is
  // removed). A faint top light gives it body; pressed, it sinks.
  primary:
    "border border-accent-rim bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_-1px_0_rgb(0_0_0/0.25)] hover:bg-accent-hover active:bg-accent-pressed active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] disabled:border-transparent disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none",
  // The primary button in teal, the colour of work done: for the one act
  // that finishes a piece of work. White on the solid teal reads in both
  // themes.
  complete:
    "border border-status-resolved-line bg-status-resolved-solid text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_-1px_0_rgb(0_0_0/0.25)] hover:brightness-110 active:brightness-95 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] disabled:border-transparent disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none",
  // The tinted kinds share one shape: their colour's text on its subtle
  // ground, within its line. Written out rather than built from the tone's
  // name, so Tailwind sees every class.
  view: cx(
    "border border-accent-line bg-accent-subtle text-accent-text shadow-control hover:border-accent-rim active:brightness-95",
    disabledOutlined,
  ),
  edit: cx(
    "border border-warning-line bg-warning-subtle text-warning-text shadow-control hover:border-warning-solid active:brightness-95",
    disabledOutlined,
  ),
  add: cx(
    "border border-success-line bg-success-subtle text-success-text shadow-control hover:border-success-solid active:brightness-95",
    disabledOutlined,
  ),
  manage: cx(
    "border border-manage-line bg-manage-subtle text-manage-text shadow-control hover:border-manage-solid active:brightness-95",
    disabledOutlined,
  ),
  restore: cx(
    "border border-info-line bg-info-subtle text-info-text shadow-control hover:border-info-solid active:brightness-95",
    disabledOutlined,
  ),
  // Outlined on purpose: in a dense table a solid red block shouts. The
  // solid treatment is `danger`, for the final confirmation.
  destructive: cx(
    "border border-danger-line bg-danger-subtle text-danger-text shadow-control hover:border-danger-solid active:brightness-95",
    disabledOutlined,
  ),
  danger:
    "border border-danger-solid bg-danger-solid text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_-1px_0_rgb(0_0_0/0.25)] hover:brightness-110 active:brightness-95 disabled:border-transparent disabled:bg-sunken disabled:text-fg-disabled disabled:shadow-none",
  secondary: cx(
    "border border-line-strong bg-surface text-fg shadow-control hover:border-line-control hover:bg-hover active:bg-sunken",
    disabledOutlined,
  ),
  quiet:
    "text-fg-muted hover:bg-hover hover:text-fg active:bg-sunken disabled:bg-transparent disabled:text-fg-disabled",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-4 text-base",
};

/**
 * The classes for a button of this variant and size, for elements that must
 * look like a button but are not one. Prefer ButtonLink for a link, which
 * also brings the icon every button has.
 */
export const buttonClasses = ({
  variant = "primary",
  size = "md",
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string =>
  cx(base, variants[variant], sizes[size]);

export type ButtonIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The icon at the start, and an optional one at the end (a ›, a ↗). */
export function ButtonContent({
  icon: Icon,
  trailingIcon: Trailing,
  children,
}: {
  icon: ButtonIcon;
  trailingIcon?: ButtonIcon;
  children?: ReactNode;
}) {
  return (
    <>
      <Icon aria-hidden="true" strokeWidth={2} className="size-3.5 shrink-0" />
      {children}
      {Trailing && (
        <Trailing
          aria-hidden="true"
          strokeWidth={2}
          className="-mr-0.5 size-3.5 shrink-0 opacity-80"
        />
      )}
    </>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  trailingIcon,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Required: every button shows what it does with an icon as well as words. */
  icon: ButtonIcon;
  /** An icon after the words, for a button that opens something. */
  trailingIcon?: ButtonIcon;
}) {
  return (
    <button
      type={type}
      className={cx(buttonClasses({ variant, size }), className)}
      {...props}
    >
      <ButtonContent icon={icon} trailingIcon={trailingIcon}>
        {children}
      </ButtonContent>
    </button>
  );
}
