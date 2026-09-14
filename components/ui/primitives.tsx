import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      className={cx(
        variant === "primary" && "primary-button",
        variant === "secondary" && "secondary-button",
        variant === "ghost" && "ghost-button",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={cx("panel", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  return <span className={cx("ui-badge", `ui-badge-${tone}`, className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("ui-input", className)} {...props} />;
}

export function StatePanel({
  title,
  children,
  tone = "empty",
}: {
  title: string;
  children?: ReactNode;
  tone?: "loading" | "empty" | "error" | "unauthorized" | "success";
}) {
  return (
    <section className={cx("ui-state", `ui-state-${tone}`)} role={tone === "error" ? "alert" : undefined}>
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </section>
  );
}
