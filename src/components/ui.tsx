import Link from "next/link";
import type { ReactNode } from "react";

// Small shared building blocks. Kept deliberately plain: type and spacing do the work.

export function Stat({ value, label, unit }: { value: ReactNode; label: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="num text-3xl leading-none">
        {value}
        {unit && <span className="ml-0.5 text-base font-medium text-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`app-panel rounded-2xl bg-paper p-4 ${className}`}>{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  const styles = {
    primary: "bg-ink text-fog",
    quiet: "border border-line bg-paper text-ink",
    danger: "border border-z5/40 text-z5",
  }[variant];
  return (
    <button
      className={`action-button rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-ink underline decoration-line underline-offset-4">
      {children}
    </Link>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header>
      {sub && <p className="text-sm text-muted">{sub}</p>}
      <h1 className="condensed mt-1 text-[34px] leading-tight font-bold tracking-tight text-balance">{children}</h1>
    </header>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3 pt-2" aria-busy>
      <div className="h-4 w-1/3 rounded bg-line" />
      <div className="h-8 w-2/3 rounded bg-line" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-16 rounded-2xl bg-paper" />
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-ink";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Opens the live treadmill screen, for a planned run or (without `workoutId`) an unplanned one. */
export function StartTreadmill({ workoutId, quiet = false, children }: { workoutId?: string; quiet?: boolean; children: ReactNode }) {
  return (
    <Link
      href={workoutId ? `/treadmill?workout=${workoutId}` : "/treadmill"}
      className={`inline-block rounded-xl px-4 py-2.5 text-sm font-medium ${quiet ? "border border-line bg-paper text-ink" : "bg-ink text-fog"}`}
    >
      {children}
    </Link>
  );
}
