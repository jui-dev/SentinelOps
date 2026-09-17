import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const variants: Record<Variant, string> = {
  primary:
    "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400",
  secondary:
    "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 disabled:text-slate-400",
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
