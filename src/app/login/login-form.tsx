"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, { error: null });
  return (
    <form action={action} className="mt-10 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm text-muted" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-lg outline-none focus:border-ink"
      />
      {state.error && <p className="text-sm text-z5">{state.error}</p>}
      <button
        disabled={pending}
        className="w-full rounded-xl bg-ink px-4 py-3 font-medium text-fog disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
