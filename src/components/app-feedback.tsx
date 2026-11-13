"use client";

import { Lightbulb } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { sendAppFeedback } from "@/app/(app)/actions";
import { inputClass } from "./ui";

/** A corner button for jotting down thoughts about the app; read them back with `npm run feedback`. */
export function AppFeedback() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"sent" | "error" | null>(null);

  function close() {
    setOpen(false);
    setStatus(null);
  }

  async function send() {
    setSaving(true);
    setStatus(null);
    try {
      const { ok } = await sendAppFeedback({ body, page: pathname });
      if (!ok) throw new Error("empty");
      setBody("");
      setStatus("sent");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Feedback on the app"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-line"
      >
        <Lightbulb size={20} strokeWidth={1.6} aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/50" role="dialog" aria-modal aria-labelledby="feedback-title" onClick={close}>
          <div
            className="mx-auto w-full max-w-lg rounded-t-2xl bg-fog p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="feedback-title" className="text-xl font-semibold">
              Feedback on the app
            </h2>
            <p className="mt-1 text-sm text-muted">Something missing, confusing or broken? Saved with this page ({pathname}).</p>
            <textarea
              autoFocus
              rows={5}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setStatus(null);
              }}
              maxLength={4000}
              className={`${inputClass} mt-4 resize-none`}
            />
            {status === "sent" && <p className="mt-2 text-sm text-good">Saved. Thanks.</p>}
            {status === "error" && <p className="mt-2 text-sm text-warn">Could not save it. Try again.</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={saving || !body.trim()}
                onClick={send}
                className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-fog disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={close} className="rounded-xl border border-line bg-paper px-4 py-2.5 text-sm font-medium text-ink">
                {status === "sent" ? "Done" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
