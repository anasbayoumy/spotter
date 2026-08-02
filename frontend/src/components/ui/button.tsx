import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children: ReactNode;
  readonly busy?: boolean;
  readonly variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    busy = false,
    children,
    className = "",
    disabled,
    type = "button",
    variant = "primary",
    ...props
  },
  ref,
): React.JSX.Element {
  return (
    <button
      aria-busy={busy}
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled === true || busy}
      ref={ref}
      type={type}
      {...props}
    >
      {busy ? <span aria-hidden="true" className="button__spinner" /> : null}
      <span>{children}</span>
    </button>
  );
});
