import type { AnchorHTMLAttributes } from "react";

export type WhatsAppCtaProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  phone: string;
  message?: string;
  label?: string;
};

export function WhatsAppCta({ phone, message = "", label = "Order on WhatsApp", className = "", ...rest }: WhatsAppCtaProps) {
  const digits = phone.replace(/[^0-9]/g, "");
  if (!/^[0-9]{8,15}$/.test(digits)) {
    return <span role="status">WhatsApp contact unavailable</span>;
  }
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return (
    <a
      className={["tg-button", "tg-button--primary", className].filter(Boolean).join(" ")}
      href={`https://wa.me/${digits}${query}`}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {label}
    </a>
  );
}
