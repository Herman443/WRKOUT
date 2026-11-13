import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pt-[calc(3rem+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
      <Mark />
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">WRKOUT</h1>
      <p className="mt-1 text-muted">Your training, planned and adjusted.</p>
      <Suspense>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const next = (await searchParams).next;
  return <LoginForm next={typeof next === "string" ? next : "/"} />;
}

function Mark() {
  const bars: [string, number][] = [
    ["bg-z1", 34],
    ["bg-z2", 50],
    ["bg-z4", 86],
    ["bg-z2", 50],
    ["bg-z5", 100],
    ["bg-z1", 34],
  ];
  return (
    <div className="flex h-14 items-end gap-1.5" aria-hidden>
      {bars.map(([c, h], i) => (
        <div key={i} className={`${c} w-3 rounded-[3px]`} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
