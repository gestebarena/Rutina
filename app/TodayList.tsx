"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markIntake, markMany, skipIntake, unmarkIntake, postponeIntake, markMissing, markMaintenanceNow } from "./actions";
import { shortDayLabel, addDays } from "@/lib/madrid";

export type MaintRow = { itemId: string; occId: string | null; name: string; dose: string; frequency: string; interval: number; lastTaken: string | null; daysAgo: number | null; nextDue: string; overdue: boolean };
function ddmm(d: string | null): string { return d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—"; }

// Desfase (min) de una zona en un instante.
function tzOffsetMin(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}
// "AAAA-MM-DDTHH:MM" (reloj de pared en tz) -> instante (ms).
function wallToMs(local: string, tz: string): number {
  const [d, t] = local.split("T"); const [Y, M, D] = d.split("-").map(Number); const [h, m] = t.split(":").map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  return guess - tzOffsetMin(tz, new Date(guess)) * 60000;
}
// instante -> "AAAA-MM-DDTHH:MM" (reloj de pared en tz).
function msToLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)).replace(" ", "T");
}

export type Slot = {
  occId: string;             // id de la DoseOccurrence (identidad estable para marcar)
  itemId: string;
  slot: string;
  day: string;
  name: string;
  dose: string;
  time: string | null;       // hora a mostrar (zona del que mira)
  planTime?: string | null;  // hora del plan (ancla) para la lógica
  altTime?: string | null;   // hora del plan para mostrar como referencia si difiere
  frequency: string;
  rule: string | null;
  capped: boolean;
  category: string;
  taken: boolean;
  skipped: boolean;
  postponed?: boolean;
  postponeUntil?: string | null;
  takenTime: string | null;
  must: boolean;
  levelLabel?: string | null;
  progressLabel?: string | null;
  fastUntil?: string | null;
  skippedReason?: string | null;
  stock?: number | null;
  stockLow?: boolean;
  lastTakenAgo?: number | null;
  dueInMin?: number | null; // minutos hasta la hora prevista (negativo = ya pasó)
  prev?: { day: string; status: string; time: string | null } | null;
  hasHistory?: boolean;
  recordedBy?: string | null;
  recordedAtLabel?: string | null;
  editWhen?: string | null; // "AAAA-MM-DDTHH:MM" en zona del que mira (para editar)
  foodNote?: string | null; // maintenance opcional: "hace X días · ideal cada 7"
};

export type Group = { key: string; title: string; slots: Slot[] };
export type DayBlock = { day: string; slots: Slot[] };
export type Mark = { slot: string; status: string; time: string | null };
export type DayHist = { day: string; marks: Mark[] };

const SKIP_REASONS = ["Fiebre", "Vómito", "Enfermo", "Viaje", "Vista a FAI", "Otro motivo"];
const MAINT_CATS = new Set(["THREE_WEEK", "WEEKLY", "BIWEEKLY", "MAINTENANCE"]);
function isMaintCat(cat: string) { return MAINT_CATS.has(cat); }

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

type MarkTarget = { title: string; day: string; slots: { itemId: string; slot: string; occId: string }[]; isTreatment: boolean; isMaint: boolean };
type Bucket = { time: string | null; planTime: string | null; altTime: string | null; slots: Slot[] };

function bucketByTime(slots: Slot[]): Bucket[] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = s.time ?? "∅";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return [...map.entries()]
    .map(([k, v]) => ({ time: k === "∅" ? null : k, planTime: v[0].planTime ?? v[0].time ?? null, altTime: v[0].altTime ?? null, slots: v }))
    .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0));
}

function fmtElapsed(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}


export default function TodayList({
  todaySlots,
  maintDetail,
  pastDays,
  tomorrow,
  backDays,
  treatmentTakenTimes,
  nowMin,
  historyByItem,
  viewerCode,
  anchorCode,
  viewerTz,
  anchorTz,
  viewerToday,
  planToday,
  viewerCityLabel,
  viewerTzLabel,
  anchorTzLabel,
}: {
  todaySlots: Slot[];
  maintDetail: MaintRow[];
  pastDays: DayBlock[];
  tomorrow: DayBlock;
  backDays: number;
  treatmentTakenTimes: { name: string; time: string }[];
  nowMin: number;
  historyByItem: Record<string, DayHist[]>;
  viewerCode: string;
  anchorCode: string;
  viewerTz: string;
  anchorTz: string;
  viewerToday: string;
  planToday: string;
  viewerCityLabel: string;
  viewerTzLabel?: string;
  anchorTzLabel?: string;
}) {
  const [dialog, setDialog] = useState<MarkTarget | null>(null);
  const [when, setWhen] = useState(() => msToLocal(Date.now(), viewerTz));
  // Convierte el valor del selector (hora local de Nico) a la hora del plan (MAD) para guardar.
  const toAnchor = (localViewer: string) => msToLocal(wallToMs(localViewer, viewerTz), anchorTz).replace("T", " ");
  const [showPostpone, setShowPostpone] = useState(false);
  const [pending, startTransition] = useTransition();
  const [skipTarget, setSkipTarget] = useState<{ occId: string; day: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [histItem, setHistItem] = useState<{ itemId: string; name: string; hist: DayHist[] } | null>(null);
  const [detail, setDetail] = useState<Slot | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [postDate, setPostDate] = useState(() => addDays(planToday, 2)); // calendario de posponer
  const [adjustPlan, setAdjustPlan] = useState(true); // maintenance: ¿ajustar el plan al mover/marcar?

  function openHistory(s: Slot) {
    setHistItem({ itemId: s.itemId, name: s.name, hist: historyByItem[s.itemId] ?? [] });
  }
  function openDetail(s: Slot) {
    setConfirmDel(false);
    setDetail(s);
  }
  // Editar una toma pasada: abre el pop-up con su hora ya puesta (o la del plan).
  function editFromDetail() {
    if (!detail) return;
    const s = detail;
    setDetail(null);
    setWhen(s.editWhen || defaultWhen(s.day, s.planTime ?? null));
    setShowPostpone(false);
    setDialog({ title: s.name, day: s.day, slots: [{ itemId: s.itemId, slot: s.slot, occId: s.occId }], isTreatment: s.category === "TREATMENT", isMaint: isMaintCat(s.category) });
  }
  const nextRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);

  function toggleSelect(key: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const now = nowMin;
  let nextKey: string | null = null;
  let bestScore = Infinity;
  for (const s of todaySlots) {
    if (s.taken || s.skipped || s.postponed || !s.planTime) continue;
    const diff = toMin(s.planTime) - now;
    const score = diff >= 0 ? diff : 100000 - diff;
    if (score < bestScore) { bestScore = score; nextKey = `${s.itemId}|${s.slot}`; }
  }

  useEffect(() => {
    const el = nextRef.current || todayRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sugerencia por defecto del selector: la hora del PLAN si la toma ya no es reciente
  // (su hora prevista pasó hace más de 90 min, o es de un día anterior); si no, "ahora".
  function defaultWhen(day: string, planSlotTime: string | null): string {
    if (planSlotTime && /^\d{2}:\d{2}$/.test(planSlotTime)) {
      const planMs = wallToMs(`${day}T${planSlotTime}`, anchorTz);
      if (Date.now() - planMs > 90 * 60000) return msToLocal(planMs, viewerTz);
    }
    return msToLocal(Date.now(), viewerTz);
  }
  function openDialog(title: string, day: string, slots: { itemId: string; slot: string; occId: string }[], isTreatment: boolean, planSlotTime: string | null, isMaint = false) {
    setWhen(defaultWhen(day, planSlotTime));
    setShowPostpone(false);
    setAdjustPlan(true);
    setPostDate(addDays(planToday, 2));
    setDialog({ title, day, slots, isTreatment, isMaint });
  }
  function openSingle(s: Slot) {
    openDialog(s.name, s.day, [{ itemId: s.itemId, slot: s.slot, occId: s.occId }], s.category === "TREATMENT", s.planTime ?? null, isMaintCat(s.category));
  }
  function openPack(b: Bucket, day: string) {
    const pend = b.slots.filter((s) => !s.taken && !s.skipped && !s.postponed);
    openDialog(b.time ? `Toma de las ${b.time} (${pend.length})` : `${pend.length} tomas`, day, pend.map((s) => ({ itemId: s.itemId, slot: s.slot, occId: s.occId })), false, b.planTime);
  }
  function markSelectedInPack(b: Bucket, day: string) {
    const sel = b.slots.filter((s) => !s.taken && !s.skipped && !s.postponed && selected.has(`${s.itemId}|${s.slot}`));
    openDialog(`${sel.length} seleccionadas`, day, sel.map((s) => ({ itemId: s.itemId, slot: s.slot, occId: s.occId })), false, b.planTime);
  }
  function confirmMark() {
    if (!dialog) return;
    const d = dialog;
    const anchorWhen = toAnchor(when);
    startTransition(async () => {
      if (d.slots.length === 1) await markIntake(d.slots[0].occId, anchorWhen, d.isMaint ? adjustPlan : true);
      else await markMany(d.slots.map((s) => s.occId), anchorWhen);
      setSelected(new Set());
      setDialog(null);
    });
  }
  function doPostpone(mins: number) {
    if (!dialog || dialog.slots.length !== 1) return;
    const s = dialog.slots[0];
    const untilAnchor = msToLocal(Date.now() + mins * 60000, anchorTz).replace("T", " ");
    startTransition(async () => {
      await postponeIntake(s.occId, untilAnchor, false);
      setDialog(null);
    });
  }
  // Posponer a otro DÍA (calendario / presets de días). Para maintenance, con opción de ajustar el plan.
  function doPostponeToDate(dateStr: string) {
    if (!dialog || dialog.slots.length !== 1) return;
    const s = dialog.slots[0];
    const until = `${dateStr} 09:00`;
    const adj = dialog.isMaint ? adjustPlan : false;
    startTransition(async () => { await postponeIntake(s.occId, until, adj); setDialog(null); });
  }
  function doSkip(reason: string) {
    if (!skipTarget) return;
    const t = skipTarget;
    startTransition(async () => { await skipIntake(t.occId, reason); setSkipTarget(null); });
  }

  const whenDate = when.slice(0, 10);
  const dayLabel = whenDate === viewerToday ? "hoy" : whenDate === addDays(viewerToday, -1) ? "ayer" : shortDayLabel(whenDate);

  function dayHeading(day: string): string {
    if (day === planToday) return "Hoy";
    if (day === addDays(planToday, -1)) return "Ayer";
    if (day === addDays(planToday, 1)) return "Mañana";
    return shortDayLabel(day);
  }

  let warning: string | null = null;
  if (dialog?.isTreatment) {
    const hhmm = toAnchor(when).slice(11, 16);
    for (const t of treatmentTakenTimes) {
      if (Math.abs(toMin(hhmm) - toMin(t.time)) < 15) { warning = `Ojo: "${t.name}" se marcó a las ${t.time}. Separa los treatment foods al menos 15 min.`; break; }
    }
  }

  const anyMissed = pastDays.some((d) => d.slots.some((s) => !s.taken && !s.skipped && !s.postponed));

  // Pendientes de resolver: días pasados sin marcar + de hoy lo que ya venció (medicinas/treatment)
  // + maintenance que toca hoy o está atrasado. Se muestran pegados arriba y nunca se pierden.
  const unresolved = (s: Slot) => !s.taken && !s.skipped && !s.postponed;
  const pendingList: { s: Slot; label: string }[] = [
    ...pastDays.flatMap((d) => d.slots.filter(unresolved).map((s) => ({ s, label: dayHeading(d.day) }))),
    ...todaySlots.filter((s) => unresolved(s) && (isMaintCat(s.category) || (!!s.planTime && toMin(s.planTime) <= now))).map((s) => ({ s, label: isMaintCat(s.category) ? "food" : "hoy" })),
  ];

  const sortedMaint = [...maintDetail].sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || a.nextDue.localeCompare(b.nextDue));

  // Render de la agenda cronológica (todo hoy en un solo listado por hora).
  function renderAgenda() {
    return (
        <div className="space-y-3">
          {bucketByTime(todaySlots).map((b) => {
            const pend = b.slots.filter((s) => !s.taken && !s.skipped && !s.postponed);
            const isNextBucket = b.slots.some((s) => `${s.itemId}|${s.slot}` === nextKey);
            const selInPack = pend.filter((s) => selected.has(`${s.itemId}|${s.slot}`)).length;
            return (
              <div key={b.time ?? "sinhora"} id={isNextBucket ? "ahora" : undefined} ref={isNextBucket ? nextRef : undefined}
                className={`scroll-mt-48 rounded-2xl border p-3 ${isNextBucket ? "border-sky-400 ring-2 ring-sky-200 bg-white" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-bold ${isNextBucket ? "text-3xl text-sky-700" : "text-xl text-slate-700"}`}>
                    {b.time ? <>{b.time}<span className="ml-1.5 text-sm font-normal text-slate-400">{viewerCode}</span></> : "Sin hora fija"}
                    {b.altTime && <span className="ml-2 text-sm font-normal text-slate-400">· plan {b.altTime} {anchorCode}</span>}
                  </span>
                  {selInPack > 0 ? (
                    <button onClick={() => markSelectedInPack(b, b.slots[0].day)} disabled={pending} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">✓ Marcar {selInPack} elegidas</button>
                  ) : pend.length > 1 && (
                    <button onClick={() => openPack(b, b.slots[0].day)} disabled={pending} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">✓ Marcar todo ({pend.length})</button>
                  )}
                </div>
                {pend.length > 1 && <p className="text-xs text-slate-400 mb-1">Toca el ○ para elegir varias, o el nombre para marcar una.</p>}
                <div className="divide-y divide-slate-100">
                  {b.slots.map((s) => (
                    <ItemRow key={`${s.itemId}|${s.slot}`} s={s} pending={pending} start={startTransition}
                      onMark={() => openSingle(s)} big={isNextBucket && !s.taken && !s.skipped && !s.postponed}
                      selectable={pend.length > 1} selected={selected.has(`${s.itemId}|${s.slot}`)}
                      onToggleSelect={() => toggleSelect(`${s.itemId}|${s.slot}`)} onHistory={() => openHistory(s)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
    );
  }

  return (
    <>
      {/* Pendientes de resolver: pegados arriba, nunca se pierden del scroll. */}
      {pendingList.length > 0 && (
        <div id="pendientes" className="sticky top-2 z-20 rounded-2xl border-2 border-red-200 bg-red-50/95 backdrop-blur p-3 shadow-md">
          <p className="text-sm font-bold text-red-700 mb-1.5">⚠️ Pendiente de resolver ({pendingList.length})</p>
          <div className="space-y-0.5 max-h-52 overflow-y-auto">
            {pendingList.map(({ s, label }) => (
              <button key={s.occId} onClick={() => openSingle(s)} disabled={pending} className="w-full flex items-center gap-2 text-left text-sm py-1 disabled:opacity-60">
                <span className="w-5 shrink-0 text-center">{catIcon(s.category)}</span>
                <span className="flex-1 min-w-0 truncate text-slate-800">{s.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{label === "hoy" ? (s.time ?? "hoy") : label === "food" ? "🥣" : label}</span>
                <span className="shrink-0 text-slate-300">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {viewerTzLabel && anchorTzLabel && (
        <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3 text-sm text-sky-800">
          <p>🌍 Las horas se muestran en <strong>{viewerTzLabel}</strong> ({viewerCode}).</p>
          <p className="text-xs text-sky-600 mt-0.5">Al lado, &quot;plan XX:XX {anchorCode}&quot; = la hora del plan en {anchorTzLabel}, que no cambia.</p>
        </div>
      )}

      {backDays < 30 && (
        <div className="text-center">
          <a href={`/?dias=${Math.min(30, backDays + 7)}`} className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-sky-700">
            ⤒ Cargar una semana más
          </a>
        </div>
      )}

      {/* Días pasados (compactos). El primero con algo sin marcar lleva el ancla "atrasadas". */}
      {(() => {
        const firstMissedIdx = pastDays.findIndex((d) => d.slots.some((s) => !s.taken && !s.skipped && !s.postponed));
        return pastDays.map((d, i) => (
          <CompactDay key={d.day} anchor={i === firstMissedIdx ? "atrasadas" : undefined} day={d.day} slots={d.slots} heading={dayHeading(d.day)} state="past" pending={pending} start={startTransition} onMark={openSingle} onDetail={openDetail} />
        ));
      })()}

      {/* HOY (interactivo) */}
      <div ref={todayRef}>
        <h2 className="text-center text-sm font-bold text-sky-700 uppercase tracking-widest mb-2">— Hoy —</h2>
      </div>

      {/* Agenda del día: todo por hora (medicinas, maintenance obligatorios y opcionales, y treatment) */}
      {renderAgenda()}

      {/* Mañana (vista previa) */}
      {tomorrow.slots.length > 0 && (
        <CompactDay day={tomorrow.day} slots={tomorrow.slots} heading={dayHeading(tomorrow.day)} state="future" pending={pending} start={startTransition} onMark={openSingle} onDetail={openDetail} />
      )}

      {/* Detalle de maintenance foods: última / próxima, para incorporar oportunistamente */}
      {maintDetail.length > 0 && (
        <section id="maintenance" className="scroll-mt-24">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide px-1 mb-1">🥣 Maintenance foods</h2>
          <p className="text-xs text-slate-400 px-1 mb-2">Última toma y próxima recomendada. Si en una comida conviene incorporar uno, tocá &quot;Ahora&quot; y se recalcula la próxima según su frecuencia.</p>
          <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
            {sortedMaint.map((m) => (
              <div key={m.itemId} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{m.name} <span className="text-xs font-normal text-slate-400">{m.dose}</span></p>
                  <p className="text-xs text-slate-500">{m.frequency} · última {ddmm(m.lastTaken)}{m.daysAgo != null ? ` (hace ${m.daysAgo} d)` : ""}</p>
                  <p className={`text-xs ${m.overdue ? "text-red-600 font-medium" : "text-slate-500"}`}>próxima: {ddmm(m.nextDue)}{m.overdue ? " · atrasado" : ""}</p>
                </div>
                <button onClick={() => startTransition(async () => { await markMaintenanceNow(m.itemId); })} disabled={pending}
                  className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">🍽 Ahora</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <StatusBanner slots={todaySlots} anyMissed={anyMissed} now={now} />

      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setDialog(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{dialog.title}</h3>
            <p className="text-slate-500 text-sm mb-4">{dialog.slots.length > 1 ? "Se marcarán todas a esta hora." : ""}</p>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">¿Cuándo se tomó?</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg text-center focus:border-sky-500 focus:outline-none" />
              <span className="mt-1 block text-center text-sm font-medium text-sky-700">Anotando: {dayLabel} · hora local de Nico ({viewerCode})</span>
            </label>
            {warning && <p className="mt-3 text-sm text-amber-700 bg-amber-50 rounded-xl p-3">⚠️ {warning}</p>}
            {dialog.isMaint && (
              <label className="mt-3 flex items-start gap-2 text-xs text-slate-600 bg-violet-50 rounded-xl p-2.5">
                <input type="checkbox" checked={adjustPlan} onChange={(e) => setAdjustPlan(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>Recalcular la próxima <b>desde esta toma</b> (cada {dialog.slots.length === 1 ? "" : ""}su frecuencia). Destildá para mantener la fecha ya planeada.</span>
              </label>
            )}
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDialog(null)} className="flex-1 rounded-xl border border-slate-300 py-3 font-medium text-slate-600">Cancelar</button>
              <button onClick={confirmMark} disabled={pending} className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white disabled:opacity-60">
                {pending ? "Guardando…" : "Confirmar"}
              </button>
            </div>
            {dialog.slots.length === 1 && (
              <>
                <button onClick={() => { const d = dialog; setDialog(null); setSkipTarget({ occId: d.slots[0].occId, day: d.day, name: d.title }); }}
                  className="mt-3 w-full rounded-xl border border-slate-200 py-2 text-sm text-slate-500">No se tomó (saltar)</button>
                {showPostpone ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-center text-xs text-slate-400">Posponer a:</p>
                    <div className="grid grid-cols-4 gap-2">
                      <button onClick={() => doPostpone(120)} disabled={pending} className="rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">+2 h</button>
                      <button onClick={() => doPostponeToDate(addDays(planToday, 1))} disabled={pending} className="rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Mañana</button>
                      <button onClick={() => doPostponeToDate(addDays(planToday, 2))} disabled={pending} className="rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">+2 días</button>
                      <button onClick={() => doPostponeToDate(addDays(planToday, 7))} disabled={pending} className="rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">+1 sem</button>
                    </div>
                    <div className="flex gap-2">
                      <input type="date" value={postDate} min={planToday} onChange={(e) => setPostDate(e.target.value)} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                      <button onClick={() => doPostponeToDate(postDate)} disabled={pending} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">📅 A esa fecha</button>
                    </div>
                    {dialog.isMaint && (
                      <label className="flex items-start gap-2 text-xs text-slate-600 bg-violet-50 rounded-xl p-2.5">
                        <input type="checkbox" checked={adjustPlan} onChange={(e) => setAdjustPlan(e.target.checked)} className="mt-0.5 h-4 w-4" />
                        <span>Ajustar el plan desde esa fecha (la frecuencia rueda desde ahí). Destildá para mover <b>solo esta toma</b>.</span>
                      </label>
                    )}
                  </div>
                ) : (
                  <button onClick={() => setShowPostpone(true)} className="mt-2 w-full rounded-xl border border-amber-200 bg-amber-50 py-2 text-sm font-medium text-amber-700">⏰ Posponer</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {skipTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setSkipTarget(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{skipTarget.name}</h3>
            <p className="text-slate-500 text-sm mb-4">¿Por qué no se tomó?</p>
            <div className="space-y-2">
              {SKIP_REASONS.map((r) => (
                <button key={r} onClick={() => doSkip(r)} disabled={pending} className="w-full rounded-xl border border-slate-200 py-3 font-medium text-slate-700 disabled:opacity-60">{r}</button>
              ))}
            </div>
            <button onClick={() => setSkipTarget(null)} className="mt-3 w-full rounded-xl py-2 text-sm text-slate-400">Cancelar</button>
          </div>
        </div>
      )}

      {histItem && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setHistItem(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{histItem.name}</h3>
            <p className="text-slate-500 text-sm mb-3">Últimos 7 días · horas en {viewerCityLabel} ({viewerCode})</p>
            {histItem.hist.length === 0 ? (
              <p className="text-sm text-slate-400">Sin datos en los últimos 7 días.</p>
            ) : (
              <div className="space-y-1.5">
                {[...histItem.hist].reverse().map((d) => (
                  <div key={d.day} className="flex gap-2 text-sm border-b border-slate-100 pb-1.5">
                    <span className="w-20 shrink-0 capitalize text-slate-500">{shortDayLabel(d.day)}</span>
                    <span className="flex-1 text-slate-700">
                      {d.marks.map((m, i) => {
                        const icon = m.status === "TAKEN" ? "✓" : m.status === "SKIPPED" ? "⏭" : m.status === "POSTPONED" ? "⏰" : "⚠️";
                        const col = m.status === "TAKEN" ? "text-emerald-700" : m.status === "MISSED" ? "text-red-600" : "text-slate-500";
                        const lbl = m.slot === "u" ? "" : `${m.slot} `;
                        return <span key={i} className={`${col} mr-2 inline-block`}>{icon} {lbl}{m.status === "TAKEN" && m.time ? `(${m.time})` : ""}</span>;
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(() => {
              const missing = histItem.hist.reduce((n, d) => n + d.marks.filter((m) => m.status === "MISSED").length, 0);
              return missing > 0 ? (
                <button onClick={() => { const id = histItem.itemId; startTransition(async () => { await markMissing(id); setHistItem(null); }); }} disabled={pending}
                  className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 font-semibold text-white disabled:opacity-60">
                  ✓ Marcar los {missing} que faltan (a su hora del plan)
                </button>
              ) : null;
            })()}
            <button onClick={() => setHistItem(null)} className="mt-2 w-full rounded-xl border border-slate-300 py-2.5 font-medium text-slate-600">Cerrar</button>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800">{detail.name}</h3>
            <p className="text-slate-500 text-sm mb-3">{detail.slot === "u" ? "sin hora fija" : `plan ${detail.slot}`}</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Estado</dt>
                <dd className="font-medium text-slate-700">{detail.taken ? "✓ Tomada" : detail.skipped ? `⏭ Saltada${detail.skippedReason ? ` (${detail.skippedReason})` : ""}` : detail.postponed ? "⏰ Pospuesta" : "—"}</dd></div>
              {detail.taken && (
                <div className="flex justify-between gap-3"><dt className="text-slate-400">Hora de la toma</dt>
                  <dd className="font-medium text-slate-700">{detail.takenTime || "sin hora"}</dd></div>
              )}
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Anotó</dt>
                <dd className="font-medium text-slate-700">{detail.recordedBy || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">Registrado</dt>
                <dd className="font-medium text-slate-700 text-right">{detail.recordedAtLabel || "—"}</dd></div>
              {detail.prev && (
                <div className="flex justify-between gap-3"><dt className="text-slate-400">Anterior</dt>
                  <dd className="font-medium text-slate-700 text-right">{prevLabel(detail.prev)?.replace("anterior: ", "")}</dd></div>
              )}
            </dl>
            {confirmDel ? (
              <div className="mt-5 rounded-xl bg-red-50 border border-red-200 p-3">
                <p className="text-sm text-red-700 mb-2">¿Seguro que quieres borrar este registro?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDel(false)} className="flex-1 rounded-xl border border-slate-300 py-2 text-sm text-slate-600">No</button>
                  <button onClick={() => { const d = detail; setDetail(null); startTransition(async () => { await unmarkIntake(d.occId); }); }} disabled={pending}
                    className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60">Sí, borrar</button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex gap-3">
                <button onClick={editFromDetail} className="flex-1 rounded-xl border border-sky-300 py-2.5 font-medium text-sky-700">✏️ Editar</button>
                <button onClick={() => setConfirmDel(true)} className="flex-1 rounded-xl border border-red-300 py-2.5 font-medium text-red-700">🗑️ Borrar</button>
              </div>
            )}
            <button onClick={() => setDetail(null)} className="mt-3 w-full rounded-xl py-2 text-sm text-slate-400">Cerrar</button>
          </div>
        </div>
      )}
    </>
  );
}

function Check({ on, small }: { on: boolean; small?: boolean }) {
  const sz = small ? "h-6 w-6 text-sm" : "h-9 w-9 text-lg";
  return (
    <span className={`flex ${sz} shrink-0 items-center justify-center rounded-full border-2 ${on ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
  );
}

// Bloque compacto de un día (pasado o mañana): hora | tomas con su estado.
function CompactDay({ day, slots, heading, state, pending, start, onMark, onDetail, anchor }: {
  day: string; slots: Slot[]; heading: string; state: "past" | "future";
  pending: boolean; start: React.TransitionStartFunction; onMark: (s: Slot) => void; onDetail: (s: Slot) => void; anchor?: string;
}) {
  const done = slots.filter((s) => s.taken).length;
  return (
    <section id={anchor} className="scroll-mt-48">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide px-1 mb-2 capitalize">
        {heading} <span className="lowercase font-normal text-slate-400">· {done}/{slots.length} hechas</span>
      </h2>
      <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {bucketByTime(slots).map((b) => (
          <div key={b.time ?? "sh"} className="flex gap-2 p-2">
            <span className="w-12 shrink-0 pt-1 text-sm font-semibold text-slate-500">{b.time ?? "—"}</span>
            <div className="flex-1 min-w-0">
              {b.slots.map((s) => (
                <CompactRow key={`${s.itemId}|${s.slot}`} s={s} state={state} pending={pending} onMark={() => onMark(s)} onDetail={() => onDetail(s)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactRow({ s, state, pending, onMark, onDetail }: {
  s: Slot; state: "past" | "future"; pending: boolean; onMark: () => void; onDetail: () => void;
}) {
  const icon = s.taken ? "✓" : s.skipped ? "⏭" : s.postponed ? "⏰" : state === "past" ? "⚠️" : "○";
  const color = s.taken ? "text-emerald-700" : s.skipped ? "text-slate-400" : s.postponed ? "text-amber-700" : state === "past" ? "text-red-600 font-medium" : "text-slate-400";
  const content = (
    <>
      <span className="w-5 shrink-0 text-center">{icon}</span>
      <span className={`flex-1 min-w-0 truncate ${color}`}>
        {s.name}
        {s.taken && s.takenTime && <span className="text-emerald-500"> · {s.takenTime}</span>}
        {s.skipped && s.skippedReason && <span> · {s.skippedReason}</span>}
        {s.postponed && s.postponeUntil && <span> · hasta {s.postponeUntil}</span>}
      </span>
    </>
  );
  // Ya resuelta → al tocar abre el detalle (no se desmarca).
  if (s.taken || s.skipped || s.postponed) {
    return <button onClick={onDetail} className="w-full flex items-center gap-2 py-1 text-left text-sm">{content}<span className="text-slate-300">›</span></button>;
  }
  // Pendiente/atrasada → tocable para marcarla.
  return (
    <button onClick={onMark} disabled={pending} className="w-full flex items-center gap-2 py-1 text-left text-sm">
      {content}
    </button>
  );
}

function prevLabel(p?: Slot["prev"]): string | null {
  if (!p) return null;
  const when = shortDayLabel(p.day);
  if (p.status === "TAKEN") return `anterior: ✓ ${when}${p.time ? ` ${p.time}` : ""}`;
  if (p.status === "SKIPPED") return `anterior: ⏭ saltada ${when}`;
  if (p.status === "POSTPONED") return `anterior: ⏰ pospuesta ${when}`;
  return null;
}

function HistBtn({ show, onClick }: { show?: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label="historial 7 días"
      className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:text-sky-600">🕘</button>
  );
}

function catIcon(cat: string): string {
  if (cat === "MED") return "💊";
  if (cat === "TREATMENT") return "🌅";
  if (cat === "WEEKLY" || cat === "BIWEEKLY") return "🥗";
  return "🥣"; // maintenance diario / 3x semana
}

function ItemRow({ s, pending, start, onMark, big, selectable, selected, onToggleSelect, onHistory }: {
  s: Slot; pending: boolean; start: React.TransitionStartFunction; onMark: () => void; big?: boolean;
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void; onHistory?: () => void;
}) {
  function unmark() { start(async () => { await unmarkIntake(s.occId); }); }

  // Ya tomada o saltada → compacta.
  if (s.taken || s.skipped) {
    return (
      <div className="w-full flex items-center gap-2">
        <button onClick={unmark} disabled={pending} className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left opacity-70">
          <Check on={s.taken} small />
          <span className="flex-1 min-w-0 text-sm text-slate-500">
            <span className={s.taken ? "line-through" : ""}>{s.name}</span>
            {s.taken && s.takenTime && <span className="text-emerald-600"> · {s.takenTime}</span>}
            {s.taken && s.lastTakenAgo != null && <span className="text-slate-400"> · hace {fmtElapsed(s.lastTakenAgo)}</span>}
            {s.skipped && <span> · saltada{s.skippedReason ? ` (${s.skippedReason})` : ""}</span>}
          </span>
        </button>
        <HistBtn show={s.hasHistory} onClick={() => onHistory?.()} />
      </div>
    );
  }
  // Pospuesta → compacta ámbar.
  if (s.postponed) {
    return (
      <button onClick={onMark} disabled={pending} className="w-full flex items-center gap-2 py-1.5 text-left">
        <span className="w-6 shrink-0 text-center">⏰</span>
        <span className="flex-1 min-w-0 text-sm text-amber-700">{s.name} · pospuesta{s.postponeUntil ? ` hasta ${s.postponeUntil}` : ""}</span>
      </button>
    );
  }
  // Pendiente.
  return (
    <div className="w-full flex items-center gap-3 py-2">
      {selectable
        ? <button onClick={onToggleSelect} disabled={pending} aria-label="elegir"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-lg ${selected ? "bg-sky-500 border-sky-500 text-white" : "border-slate-300 text-transparent"}`}>●</button>
        : <Check on={false} />}
      <button onClick={onMark} disabled={pending} className="flex-1 min-w-0 text-left">
        <span className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${s.must && (s.category === "WEEKLY" || s.category === "BIWEEKLY") ? "text-red-700" : "text-slate-800"} ${big ? "text-lg" : ""}`}>{catIcon(s.category)} {s.name}</span>
          {s.capped && <span className="text-xs font-medium text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">tope</span>}
          {s.levelLabel && <span className="text-xs font-medium text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">{s.levelLabel}</span>}
          {s.stockLow && <span className="text-xs font-medium text-orange-700 bg-orange-100 rounded-full px-2 py-0.5">quedan {s.stock}</span>}
        </span>
        <span className="block text-sm text-slate-500">{s.dose} · {s.frequency}</span>
        {s.foodNote && <span className={`block text-xs mt-0.5 ${s.must ? "text-red-600" : "text-slate-400"}`}>{s.must ? "⚠️ " : "🗓️ "}{s.foodNote}</span>}
        {s.progressLabel && <span className="block text-xs text-violet-700 mt-0.5">📈 {s.progressLabel}</span>}
        {s.fastUntil && <span className="block text-xs text-sky-700 mt-0.5">🍽️ ya puede comer a las {s.fastUntil}</span>}
        {s.rule && <span className="block text-xs text-amber-700 mt-0.5">⚠️ {s.rule}</span>}
        <DoseIndicator dueInMin={s.dueInMin} ago={s.lastTakenAgo} />
        {prevLabel(s.prev) && <span className="block text-xs text-slate-400 mt-0.5">↩︎ {prevLabel(s.prev)}</span>}
      </button>
      <HistBtn show={s.hasHistory} onClick={() => onHistory?.()} />
    </div>
  );
}

// Indicador según la HORA PREVISTA de la toma (no el intervalo desde la anterior).
function DoseIndicator({ dueInMin, ago }: { dueInMin?: number | null; ago?: number | null }) {
  const agoTxt = ago != null ? ` · última hace ${fmtElapsed(ago)}` : "";
  if (dueInMin == null) {
    return ago != null ? <span className="block text-xs text-slate-400 mt-0.5">⏱ última dosis hace {fmtElapsed(ago)}</span> : null;
  }
  let dot: string, text: string;
  if (dueInMin > 30) { dot = "⚪"; text = `en ${fmtElapsed(dueInMin)}`; }
  else if (dueInMin >= -20) { dot = "🟢"; text = "es su hora"; }
  else { dot = "🔴"; text = `retrasada ${fmtElapsed(-dueInMin)}`; }
  return <span className="block text-xs text-slate-500 mt-0.5">{dot} {text}{agoTxt}</span>;
}

function StatusBanner({ slots, anyMissed, now }: { slots: Slot[]; anyMissed: boolean; now: number }) {
  let late = anyMissed;
  let soon = false;
  for (const s of slots) {
    if (s.taken || s.skipped || s.postponed || !s.planTime) continue;
    const diff = now - toMin(s.planTime);
    if (diff > 10) late = true;
    else if (Math.abs(diff) <= 10) soon = true;
  }
  const state = late ? "red" : soon ? "yellow" : "green";
  const cfg = {
    green: { bg: "bg-emerald-600", text: "✅ Todo al día", href: null as string | null },
    yellow: { bg: "bg-amber-500", text: "⏰ Hay una toma para ahora · ver ›", href: "#ahora" },
    red: { bg: "bg-red-600", text: "⚠️ Hay tomas pendientes · ver ›", href: anyMissed ? "#atrasadas" : "#ahora" },
  }[state];
  const cls = `fixed bottom-0 left-0 right-0 z-40 ${cfg.bg} text-white text-center py-3 font-semibold shadow-lg`;
  return cfg.href
    ? <a href={cfg.href} className={cls}>{cfg.text}</a>
    : <div className={cls}>{cfg.text}</div>;
}
