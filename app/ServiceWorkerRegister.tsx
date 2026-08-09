"use client";

import { useEffect } from "react";

// Registra el service worker (necesario para instalar la app y el modo sin conexión).
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
