"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Cada cuánto refrescar los datos del servidor (medicinas marcadas, etc.) con la app en primer plano.
const INTERVAL_MS = 15000;

// Mantiene la app al día para todos los que la tengan abierta:
// - re-lee los datos del servidor (router.refresh) cada 15s mientras está visible y al volver a primer plano
// - si detecta una versión nueva desplegada, recarga para tomar el código nuevo
export default function AutoRefresh() {
  const router = useRouter();
  const version = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const checkVersion = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { v } = await r.json();
        if (!v) return;
        if (version.current == null) { version.current = v; return; } // línea base al abrir
        if (v !== version.current) { window.location.reload(); } // hay versión nueva → recargar
      } catch {
        /* sin conexión: se reintenta en el próximo tick */
      }
    };

    const tick = () => {
      if (document.visibilityState !== "visible") return; // en segundo plano no gastamos batería
      router.refresh();
      checkVersion();
    };

    checkVersion(); // fija la versión de referencia al abrir
    timer = setInterval(tick, INTERVAL_MS);

    const onForeground = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [router]);

  return null;
}
