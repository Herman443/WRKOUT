"use client";

import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/(app)/actions";

type State = "checking" | "unsupported" | "install" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle({ vapidKey }: { vapidKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // iOS only exposes Web Push to apps added to the Home Screen.
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        setState(ios ? "install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : Notification.permission === "denied" ? "denied" : "off");
    })();
  }, []);

  async function enable() {
    if (!vapidKey) return setNote("Push keys are not configured on the server.");
    setState("busy");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
    await savePushSubscription(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
    setState("on");
  }

  async function disable() {
    setState("busy");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await removePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function test() {
    const sent = await sendTestPush();
    setNote(sent ? "Sent. It should arrive in a few seconds." : "No device received it. Try turning notifications off and on.");
  }

  const button = "rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50";
  return (
    <div>
      {state === "install" && (
        <p className="text-[15px]">On iPhone, open the Share menu and choose Add to Home Screen, then open WRKOUT from there to turn on notifications.</p>
      )}
      {state === "unsupported" && <p className="text-[15px]">This browser doesn&apos;t support notifications.</p>}
      {state === "denied" && <p className="text-[15px]">Notifications are blocked. Allow them for WRKOUT in your phone&apos;s settings.</p>}
      {(state === "off" || state === "busy" || state === "checking") && (
        <button onClick={enable} disabled={state !== "off"} className={`${button} bg-ink text-fog`}>
          Turn on notifications
        </button>
      )}
      {state === "on" && (
        <div className="flex flex-wrap gap-2">
          <button onClick={test} className={`${button} bg-ink text-fog`}>
            Send a test
          </button>
          <button onClick={disable} className={`${button} border border-line bg-paper`}>
            Turn off
          </button>
        </div>
      )}
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
    </div>
  );
}
