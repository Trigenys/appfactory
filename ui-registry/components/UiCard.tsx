import type { HTMLAttributes, ReactNode } from "react";

export type UiCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function UiCard({ children, className = "", ...rest }: UiCardProps) {
  return (
    <article className={["tg-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </article>
  );
}
