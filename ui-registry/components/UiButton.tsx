import type { ButtonHTMLAttributes, ReactNode } from "react";

export type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export function UiButton({ children, className = "", variant = "primary", type = "button", ...rest }: UiButtonProps) {
  return (
    <button
      type={type}
      className={["tg-button", `tg-button--${variant}`, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
