"use client";

import { useEffect, useState } from "react";
import { savePushSub } from "./actions";

// Convierte la clave VAPID (texto) al formato que necesita el navegador.
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function EnableNotifications() {
  const [state, setState] = useState<"loading" | "on" | "off" | "unsupported" | "denied">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const json = sub.toJSON();
      await savePushSub({
        endpoint: sub.endpoint,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      });
      setState("on");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "on") return null;

  let text = "🔔 Activar avisos en este móvil";
  let help: string | null = null;
  if (state === "unsupported") {
    help = "Para recibir avisos en el iPhone, primero añade la app a la pantalla de inicio y ábrela desde ahí.";
  } else if (state === "denied") {
    help = "Los avisos están bloqueados. Actívalos en los Ajustes del móvil para esta app.";
  }

  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
      {state === "off" ? (
        <button
          onClick={enable}
          disabled={busy}
          className="w-full rounded-xl bg-amber-500 py-3 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Activando…" : text}
        </button>
      ) : (
        <p className="text-sm text-amber-800">{help}</p>
      )}
    </div>
  );
}
