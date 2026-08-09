"use client";

import { useEffect, useState, useTransition } from "react";
import { setNicoLocation } from "./actions";

// Ciudades donde puede estar Nico (por ahora estas tres).
const CITIES = [
  { value: "Europe/Madrid", label: "Madrid", code: "MAD" },
  { value: "Europe/Helsinki", label: "Helsinki", code: "HEL" },
  { value: "America/Los_Angeles", label: "Los Ángeles", code: "LAX" },
];

export default function HeaderClock({ nicoTz }: { nicoTz: string }) {
  const planTz = nicoTz;
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const city = CITIES.find((c) => c.value === planTz);
  const cityLabel = city?.label ?? planTz;

  const dateStr = new Intl.DateTimeFormat("es-ES", {
    timeZone: planTz, weekday: "long", day: "numeric", month: "long",
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("es-ES", {
    timeZone: planTz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);

  function choose(tz: string) {
    startTransition(async () => { await setNicoLocation(tz); setOpen(false); });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-left">
        <h1 className="text-2xl font-bold capitalize leading-tight">{dateStr}</h1>
        <p className="text-sky-100 text-sm">
          🕐 {timeStr} · 📍 {cityLabel} <span className="underline underline-offset-2">cambiar</span>
        </p>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-slate-800" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">¿Dónde está Nico?</h3>
            <p className="text-slate-500 text-sm mb-4">El plan no cambia (sigue anclado a Madrid). Solo se ajusta a qué hora local de donde está Nico corresponde cada toma.</p>
            <div className="space-y-2">
              {CITIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => choose(c.value)}
                  disabled={pending}
                  className={`w-full flex items-center justify-between rounded-xl border p-3 font-medium disabled:opacity-60 ${
                    c.value === planTz ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-700"
                  }`}
                >
                  <span>📍 {c.label}</span>
                  <span className="text-sm text-slate-400">{c.code}{c.value === planTz ? " · actual" : ""}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="mt-3 w-full rounded-xl py-2 text-sm text-slate-400">Cerrar</button>
          </div>
        </div>
      )}
    </>
  );
}
