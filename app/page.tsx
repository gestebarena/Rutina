import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { addDays, mondayOf, dayDiff } from "@/lib/madrid";
import HeaderClock from "./HeaderClock";
import { doseLevelForDay } from "@/lib/schedule";
import { MEDALS } from "@/lib/stats";
import { ensureGenerated } from "@/lib/generate";
import { isMaintenance, maintInterval, nextMaintDue } from "@/lib/recurrence";
import { convertWallTime, tzCode, tzLabel, wallTimeToMs } from "@/lib/tz";
import { parseTaken } from "@/lib/taken";
import { logout } from "./actions";
import TodayList, { type Slot } from "./TodayList";
import EnableNotifications from "./EnableNotifications";

// Obligaciones DIARIAS con hora (medicinas y treatment foods). Los maintenance foods van rodante, aparte.
const MUST_CATS = new Set(["MED", "TREATMENT"]);

function minDay(a: string, b: string) { return a < b ? a : b; }
function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const backDays = Math.min(30, Math.max(2, parseInt(sp.dias || "2", 10) || 2));

  const [config, viewer] = await Promise.all([
    prisma.config.findUnique({ where: { id: 1 } }),
    prisma.user.findUnique({ where: { id: session.userId } }),
  ]);
  const anchorTz = config?.planTimezone ?? "Europe/Madrid";
  const nicoTz = config?.nicoTimezone ?? anchorTz;
  const viewerTz = viewer?.timezone || nicoTz;

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: anchorTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const weekStart = mondayOf(today);
  const trackingStart = config?.trackingStart ?? today;
  const planNowHHMM = new Intl.DateTimeFormat("en-GB", { timeZone: anchorTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const planNowMin = Number(planNowHHMM.slice(0, 2)) * 60 + Number(planNowHHMM.slice(3, 5));
  const viewerToday = new Intl.DateTimeFormat("en-CA", { timeZone: viewerTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  // Genera lo que falte de hoy..+7 y pasa a MISSED lo pendiente ya vencido (lazy, idempotente).
  await ensureGenerated(prisma, today);

  // Muestra una hora real (ancla "AAAA-MM-DD HH:MM") en la zona del que mira.
  const dispTime = (rawAnchor: string | null | undefined, day: string): string | null => {
    if (!rawAnchor) return null;
    const p = parseTaken(rawAnchor, day, anchorTz);
    return convertWallTime(p.time, day, anchorTz, viewerTz);
  };
  const toViewerLocal = (rawAnchor: string | null): string | null => {
    if (!rawAnchor) return null;
    const m = rawAnchor.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
    if (!m) return null;
    const ms = wallTimeToMs(m[1], m[2], anchorTz);
    return new Intl.DateTimeFormat("sv-SE", { timeZone: viewerTz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)).replace(" ", "T");
  };
  const fmtRecorded = (d: Date | null | undefined): string | null =>
    d ? new Intl.DateTimeFormat("es-ES", { timeZone: viewerTz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : null;

  // Ventanas de datos.
  const timelineFrom = addDays(today, -backDays);
  const statsFrom = trackingStart > addDays(today, -29) ? trackingStart : addDays(today, -29);
  const histFrom = addDays(today, -7);
  const fetchLo = minDay(minDay(timelineFrom, statsFrom), minDay(histFrom, weekStart));
  const fetchHi = addDays(today, 14);

  const [items, occs, users] = await Promise.all([
    prisma.item.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.doseOccurrence.findMany({ where: { dueDate: { gte: fetchLo, lte: fetchHi } } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  // Solo occurrences de items activos.
  const occActive = occs.filter((o) => itemById.has(o.itemId));

  // Última toma TAKEN por item (para "hace X").
  const lastTakenMap = new Map<string, number>();
  for (const o of occActive) {
    if (o.status === "TAKEN" && o.takenTime) {
      const ms = parseTaken(o.takenTime, o.dueDate, anchorTz).ms;
      const cur = lastTakenMap.get(o.itemId);
      if (!cur || ms > cur) lastTakenMap.set(o.itemId, ms);
    }
  }
  // "Toma anterior" resuelta por (item, slot) antes de un día.
  const resolvedBySlot = new Map<string, { day: string; status: string; time: string | null }[]>();
  for (const o of occActive) {
    if (o.status !== "TAKEN" && o.status !== "SKIPPED" && o.status !== "POSTPONED") continue;
    const k = `${o.itemId}|${o.slotId}`;
    if (!resolvedBySlot.has(k)) resolvedBySlot.set(k, []);
    // "día" = la fecha REAL en que se tomó (takenTime), no el día del turno (dueDate) — pueden diferir en maintenance.
    const realDay = o.takenTime && /^\d{4}-\d{2}-\d{2}/.test(o.takenTime) ? o.takenTime.slice(0, 10) : o.dueDate;
    resolvedBySlot.get(k)!.push({ day: realDay, status: o.status, time: o.takenTime ? parseTaken(o.takenTime, o.dueDate, anchorTz).time : null });
  }
  const prevBefore = (itemId: string, slotId: string, beforeDay: string) => {
    const list = resolvedBySlot.get(`${itemId}|${slotId}`);
    if (!list) return null;
    let best: { day: string; status: string; time: string | null } | null = null;
    for (const r of list) if (r.day < beforeDay && (!best || r.day > best.day)) best = r;
    if (!best) return null;
    return { day: best.day, status: best.status, time: dispTime(best.time ? `${best.day} ${best.time}` : null, best.day) };
  };

  type Occ = (typeof occActive)[number];

  // Historial EDITABLE por item: tomas recientes con su occId, para ver/borrar/editar (corregir errores).
  type EditDose = { occId: string; day: string; time: string | null; status: string; who: string; editWhen: string | null };
  const editableByItem: Record<string, EditDose[]> = {};
  const missingByItem: Record<string, number> = {}; // MISSED de MUST en 7 días (para "marcar los que faltan")
  for (const o of occActive) {
    const it = itemById.get(o.itemId);
    if (!it) continue;
    if (o.status === "MISSED" && MUST_CATS.has(it.category) && o.dueDate >= histFrom && o.dueDate < today) {
      missingByItem[o.itemId] = (missingByItem[o.itemId] ?? 0) + 1;
    }
    if (o.status !== "TAKEN" && o.status !== "SKIPPED" && o.status !== "POSTPONED") continue;
    const realDay = o.takenTime && /^\d{4}-\d{2}-\d{2}/.test(o.takenTime) ? o.takenTime.slice(0, 10) : o.dueDate;
    (editableByItem[o.itemId] ??= []).push({
      occId: o.id, day: realDay,
      time: dispTime(o.status === "POSTPONED" ? o.postponeUntil : o.takenTime, realDay),
      status: o.status,
      who: userName.get(o.takenById ?? "") ?? "—",
      editWhen: toViewerLocal(o.status === "POSTPONED" ? o.postponeUntil : o.takenTime),
    });
  }
  for (const k in editableByItem) { editableByItem[k].sort((a, b) => (a.day < b.day ? 1 : -1)); editableByItem[k] = editableByItem[k].slice(0, 12); }

  // Convierte una occurrence en un Slot para la UI.
  function occToSlot(o: Occ, opts: { must: boolean; foodNote?: string | null; forToday: boolean; maintAgenda?: boolean }): Slot {
    const it = itemById.get(o.itemId)!;
    const isMaint = isMaintenance(it);
    // Maintenance en la agenda de hoy: se muestra a la mañana (09:00) pero se marca "ahora" (día = hoy).
    const agendaDay = opts.maintAgenda ? today : o.dueDate;
    const planned = o.plannedTime ?? (isMaint ? "09:00" : null);
    const time = planned ? convertWallTime(planned, agendaDay, anchorTz, viewerTz) : null;
    const altTime = planned && viewerTz !== anchorTz ? planned : null;
    const taken = o.status === "TAKEN", skipped = o.status === "SKIPPED", postponed = o.status === "POSTPONED";
    const takenDisp = dispTime(o.takenTime, o.dueDate);

    // Escalera de dosis (treatment): etiqueta "Semana X de N".
    let levelLabel: string | null = null, progressLabel: string | null = null;
    let levels: string[] = [];
    try { levels = JSON.parse(it.doseLevels || "[]"); } catch { levels = []; }
    if (opts.forToday && it.category === "TREATMENT" && levels.length > 1) {
      const last = levels.length - 1;
      const level = doseLevelForDay(it.cycleStartDay, levels.length, o.dueDate);
      levelLabel = `Semana ${level + 1} de ${levels.length}`;
      progressLabel = level >= last ? "última dosis (mantenimiento)" : `sube a ${levels[level + 1]} el lunes`;
    }

    let lastTakenAgo: number | null = null, dueInMin: number | null = null;
    if (opts.forToday && it.category === "MED") {
      const lt = lastTakenMap.get(it.id);
      if (lt) lastTakenAgo = Math.round((Date.now() - lt) / 60000);
      if (planned) dueInMin = Math.round((wallTimeToMs(o.dueDate, planned, anchorTz) - Date.now()) / 60000);
    }
    const fastUntil = it.id === "med-advagraf" && taken && o.takenTime ? dispTime(`${o.dueDate} ${addMinutes(o.takenTime.slice(11, 16), 60)}`, o.dueDate) : null;
    const stockLow = it.stock !== null && it.stockAlertAt !== null && it.stock <= it.stockAlertAt;

    return {
      occId: o.id, itemId: o.itemId, slot: o.slotId, day: agendaDay,
      name: it.name, dose: o.plannedDose || it.dose,
      time, planTime: opts.maintAgenda ? null : planned, altTime,
      frequency: it.frequency, rule: opts.forToday ? it.rule : null, capped: it.capped, category: it.category,
      taken, skipped, postponed,
      postponeUntil: postponed ? dispTime(o.postponeUntil, o.dueDate) : null,
      takenTime: postponed ? null : takenDisp,
      must: opts.must,
      levelLabel, progressLabel, fastUntil,
      skippedReason: skipped ? o.note ?? null : null,
      stock: it.stock, stockLow, lastTakenAgo, dueInMin,
      foodNote: opts.foodNote ?? null,
      prev: prevBefore(o.itemId, o.slotId, o.dueDate),
      hasHistory: !!editableByItem[o.itemId]?.length,
      recordedBy: !opts.forToday && o.status !== "PENDING" && o.status !== "MISSED" ? (userName.get(o.takenById ?? "") ?? "—") : null,
      recordedAtLabel: !opts.forToday && o.status !== "PENDING" && o.status !== "MISSED" ? fmtRecorded(o.recordedAt) : null,
      editWhen: !opts.forToday && o.status !== "PENDING" && o.status !== "MISSED" ? toViewerLocal(o.status === "POSTPONED" ? o.postponeUntil : o.takenTime) : null,
    };
  }

  let mustTotal = 0, mustPending = 0;

  // --- HOY: obligaciones diarias (medicinas + treatment foods) ---
  const todayDaily = occActive.filter((o) => o.dueDate === today && MUST_CATS.has(itemById.get(o.itemId)!.category));
  const todaySlots: Slot[] = [];
  for (const o of todayDaily) {
    mustTotal++;
    if (o.status !== "TAKEN" && o.status !== "SKIPPED" && o.status !== "POSTPONED") mustPending++;
    todaySlots.push(occToSlot(o, { must: true, forToday: true }));
  }

  // --- Maintenance foods (RODANTE): cada uno tiene UNA próxima toma abierta ---
  const maintItems = items.filter((it) => isMaintenance(it));
  const maintIds = maintItems.map((i) => i.id);
  const maintTaken = await prisma.doseOccurrence.findMany({ where: { itemId: { in: maintIds }, status: "TAKEN" }, select: { itemId: true, dueDate: true, takenTime: true } });
  const lastByItem = new Map<string, string>();
  for (const o of maintTaken) { const d = /^\d{4}-\d{2}-\d{2}/.test(o.takenTime || "") ? o.takenTime!.slice(0, 10) : o.dueDate; const c = lastByItem.get(o.itemId); if (!c || d > c) lastByItem.set(o.itemId, d); }

  type MaintRow = { itemId: string; occId: string | null; name: string; dose: string; frequency: string; interval: number; lastTaken: string | null; daysAgo: number | null; nextDue: string; overdue: boolean };
  const maintDetail: MaintRow[] = [];
  let maintDueCount = 0;
  for (const it of maintItems) {
    const open = occActive.find((o) => o.itemId === it.id && (o.status === "PENDING" || o.status === "POSTPONED"));
    const last = lastByItem.get(it.id) ?? null;
    const iv = maintInterval(it);
    const hasDates = !!it.specificDates && it.specificDates !== "[]";
    let wtarget: number | null = null;
    try { wtarget = (JSON.parse(it.weekdays || "[]") as number[])[0] ?? null; } catch { wtarget = null; }
    const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const cadence = hasDates ? "según fechas del plan"
      : it.category === "WEEKLY" && wtarget != null ? `semanal (${DAYS[wtarget]})`
      : it.category === "THREE_WEEK" ? "objetivo L/X/V" : `cada ${iv} días`;
    const nextDue = open?.dueDate ?? (last ? nextMaintDue(it, last) : today);
    const daysAgo = last ? dayDiff(last, today) : null;
    const overdue = nextDue < today;
    maintDetail.push({ itemId: it.id, occId: open?.id ?? null, name: it.name, dose: it.dose, frequency: it.frequency, interval: iv, lastTaken: last, daysAgo, nextDue, overdue });
    // Agenda de hoy: solo si toca hoy o está atrasado y no está pospuesto a una fecha futura.
    if (open) {
      const snoozeDay = open.status === "POSTPONED" && open.postponeUntil && /^\d{4}-\d{2}-\d{2}/.test(open.postponeUntil) ? open.postponeUntil.slice(0, 10) : null;
      const snoozedFuture = snoozeDay ? snoozeDay > today : false;
      if (nextDue <= today && !snoozedFuture) {
        maintDueCount++;
        const note = overdue ? `última hace ${daysAgo ?? "?"} días · atrasado (${cadence})` : (last ? `última hace ${daysAgo} días` : "aún sin registrar");
        // "must"/overdue solo si YA se pasó de día; lo que toca hoy va en la agenda sin alarma.
        todaySlots.push({ ...occToSlot(open, { must: overdue, foodNote: note, forToday: true, maintAgenda: true }), overdue });
      }
    }
  }

  // --- Días pasados (medicinas + treatment) y mañana ---
  function buildDay(day: string): Slot[] {
    const list = occActive.filter((o) => o.dueDate === day && MUST_CATS.has(itemById.get(o.itemId)!.category));
    const slots = list.map((o) => occToSlot(o, { must: true, forToday: false }));
    slots.sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : 0));
    return slots;
  }
  const pastDays: { day: string; slots: Slot[] }[] = [];
  let missedCount = 0;
  for (let d = timelineFrom; d <= yesterday; d = addDays(d, 1)) {
    const slots = buildDay(d);
    if (slots.length === 0) continue;
    missedCount += slots.filter((s) => !s.taken && !s.skipped && !s.postponed).length;
    pastDays.push({ day: d, slots });
  }
  const tomorrowBlock = { day: tomorrow, slots: buildDay(tomorrow) };

  // Treatment foods de hoy ya tomados (para el aviso de 15 min; hora en ancla MAD).
  const treatmentTakenTimes: { name: string; time: string }[] = [];
  for (const o of todayDaily) {
    const it = itemById.get(o.itemId)!;
    if (it.category === "TREATMENT" && o.status === "TAKEN" && o.takenTime) treatmentTakenTimes.push({ name: it.name, time: o.takenTime.slice(11, 16) });
  }

  const allDone = mustPending === 0 && missedCount === 0;
  const lowStock = items
    .filter((it) => it.stock !== null && it.stockAlertAt !== null && it.stock <= it.stockAlertAt)
    .map((it) => ({ name: it.name, stock: it.stock as number }));

  // Racha y estrellas desde occurrences (días completos = sin obligatorias sin resolver).
  const dayAgg = new Map<string, { total: number; done: number }>();
  for (const o of occActive) {
    const it = itemById.get(o.itemId)!;
    if (!MUST_CATS.has(it.category) || o.dueDate < statsFrom || o.dueDate > today) continue;
    const a = dayAgg.get(o.dueDate) ?? { total: 0, done: 0 };
    a.total++;
    if (o.status === "TAKEN" || o.status === "SKIPPED") a.done++;
    dayAgg.set(o.dueDate, a);
  }
  let stars = 0;
  for (const a of dayAgg.values()) stars += a.done;
  let streak = 0;
  for (let d = today; d >= statsFrom; d = addDays(d, -1)) {
    const a = dayAgg.get(d);
    if (a && a.total > 0 && a.done === a.total) streak++; else break;
  }
  const earnedMedals = MEDALS.filter((m) => streak >= m.days);

  return (
    <main className="min-h-dvh bg-sky-50 pb-16">
      <header className="bg-sky-600 text-white px-5 pt-4 pb-3 rounded-b-3xl shadow-md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sky-100 text-sm">Hola, {session.name} 👋</p>
            <HeaderClock nicoTz={nicoTz} />
            {viewerTz !== anchorTz && (
              <p className="text-[11px] text-sky-200 mt-0.5">🌍 horas en {tzLabel(viewerTz)} · el plan sigue en {tzLabel(anchorTz)}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <a href="/historial" className="text-sky-100 text-sm underline underline-offset-2">Historial</a>
            {session.role === "ADMIN" && (
              <a href="/admin" className="text-sky-100 text-sm underline underline-offset-2">Administrar</a>
            )}
            <a href="/cambiar-clave" className="text-sky-100 text-sm underline underline-offset-2">Contraseña</a>
            <form action={logout}>
              <button className="text-sky-100 text-sm underline underline-offset-2">Salir</button>
            </form>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Atrasadas · ver ›" value={`${missedCount}`} tone={missedCount > 0 ? "red" : "white"} href="#pendientes" />
          <Stat label="Maintenance foods · ver ›" value={maintDueCount > 0 ? `${maintDueCount} para hoy` : "al día"} tone="white" href="#maintenance" />
        </div>
        {allDone && <p className="mt-2 font-medium">🎉 ¡Todo lo obligatorio de hoy está hecho!</p>}

        <div className="mt-3 rounded-2xl bg-white/15 px-4 py-2 flex items-center justify-between">
          <span className="font-bold">🔥 {streak} {streak === 1 ? "día" : "días"}</span>
          <span className="font-bold">⭐ {stars}</span>
          <span className="text-lg" title="Logros de Nico">
            {MEDALS.map((m) => (
              <span key={m.days} className={earnedMedals.includes(m) ? "" : "opacity-30 grayscale"}>{m.icon}</span>
            ))}
          </span>
        </div>
      </header>

      <div className="px-4 mt-5 space-y-6 max-w-xl mx-auto">
        <EnableNotifications />

        {lowStock.length > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4">
            <p className="font-semibold text-orange-800">📦 Se está acabando</p>
            <ul className="text-sm text-orange-700 mt-1">
              {lowStock.map((s) => (<li key={s.name}>· {s.name}: quedan {s.stock}</li>))}
            </ul>
          </div>
        )}
        <TodayList
          todaySlots={todaySlots}
          maintDetail={maintDetail}
          pastDays={pastDays}
          tomorrow={tomorrowBlock}
          backDays={backDays}
          treatmentTakenTimes={treatmentTakenTimes}
          nowMin={planNowMin}
          editableByItem={editableByItem}
          missingByItem={missingByItem}
          viewerCode={tzCode(viewerTz)}
          anchorCode={tzCode(anchorTz)}
          viewerTz={viewerTz}
          anchorTz={anchorTz}
          viewerToday={viewerToday}
          planToday={today}
          viewerCityLabel={tzLabel(viewerTz)}
          viewerTzLabel={viewerTz !== anchorTz ? tzLabel(viewerTz) : undefined}
          anchorTzLabel={viewerTz !== anchorTz ? tzLabel(anchorTz) : undefined}
        />
        <p className="text-center text-xs text-slate-400 px-6">
          Esta app solo te ayuda a recordar y registrar. Las dosis y reglas las decide siempre el médico.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: string; tone: "white" | "red"; href?: string }) {
  const cls = `block rounded-2xl px-3 py-2 text-center ${tone === "red" ? "bg-red-500" : "bg-sky-500/40"}`;
  const inner = (
    <>
      <div className="text-lg font-bold leading-tight">{value}{href ? " ›" : ""}</div>
      <div className="text-[11px] text-sky-50">{label}</div>
    </>
  );
  return href ? <a href={href} className={cls}>{inner}</a> : <div className={cls}>{inner}</div>;
}
