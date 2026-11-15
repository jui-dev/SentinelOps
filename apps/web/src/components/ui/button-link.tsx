import Link from "next/link";
import type { ComponentProps } from "react";

import { ButtonContent, buttonClasses } from "./button";
import type { ButtonIcon, ButtonSize, ButtonVariant } from "./button";
import { cx } from "./cx";

/**
 * A link that looks like a button of the same kind — View, Details, Open,
 * Go to your workspace — with the icon every button carries.
 */
export function ButtonLink({
  variant = "view",
  size = "md",
  icon,
  trailingIcon,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Required: every button shows what it does with an icon as well as words. */
  icon: ButtonIcon;
  /** An icon after the words: a › for going somewhere. */
  trailingIcon?: ButtonIcon;
}) {
  return (
    <Link className={cx(buttonClasses({ variant, size }), className)} {...props}>
      <ButtonContent icon={icon} trailingIcon={trailingIcon}>
        {children}
      </ButtonContent>
    </Link>
  );
}
