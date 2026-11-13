"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className = "",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "quiet" | "danger";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-ink text-fog",
    quiet: "border border-line bg-paper text-ink",
    danger: "border border-z5/40 text-z5",
  }[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
