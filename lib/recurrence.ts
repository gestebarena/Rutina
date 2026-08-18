// Motor de recurrencia y generación de occurrences (modelo materializado).
// Ancla del plan: Europe/Madrid. Las horas "HH:MM" son de Madrid.
import { weekdayOfDay, dayDiff, addDays, mondayOf, isDueToday } from "./madrid";
import { doseLevelForDay } from "./schedule";

// Epoch (un lunes) para numerar las quincenas de forma estable.
const BIWEEK_EPOCH = "2026-01-05"; // lunes

export type ItemLike = {
  id: string;
  dose: string;
  category: string;
  recurrence: string; // DAILY | EVERY_N_DAYS | WEEKDAYS | SPECIFIC_DATES | WEEKLY | BIWEEKLY
  intervalDays: number | null;
  anchorDay: string | null;
  weekdays: string | null; // JSON [1,3,5]
  specificDates: string | null; // JSON ["2026-08-07", ...]
  cycleStartDay: string | null;
  doseLevels: string; // JSON
  times: string; // JSON (legado; solo se usa al derivar slots)
  doseDays?: string | null; // legado
};

function parseArr(s: string | null | undefined): unknown[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

// ¿Es un item de tipo "período" (semanal/quincenal, sin hora fija, una toma por período)?
export function isPeriodItem(item: { recurrence: string }): boolean {
  return item.recurrence === "WEEKLY" || item.recurrence === "BIWEEKLY";
}

// Maintenance foods: se agendan RODANTE ("cada N días desde la última toma"), no en grilla fija.
export const MAINT_CATS = new Set(["THREE_WEEK", "WEEKLY", "BIWEEKLY", "MAINTENANCE"]);
export function isMaintenance(item: { category: string }): boolean {
  return MAINT_CATS.has(item.category);
}
// Cadencia rodante en días (editable por admin vía intervalDays; si no, según la frecuencia).
export function maintInterval(item: { category: string; intervalDays?: number | null }): number {
  if (item.intervalDays && item.intervalDays > 0) return item.intervalDays;
  if (item.category === "BIWEEKLY") return 14;
  if (item.category === "WEEKLY") return 7;
  return 2; // 3x/semana y MAINTENANCE: ~cada 2 días
}

// Próxima fecha de un maintenance food a partir de `fromDate` (la última toma).
// - Con FECHAS ESPECÍFICAS acordadas (p.ej. yema): la siguiente fecha de la lista (luego, semanal).
// - 3x/semana → objetivo Lun/Mié/Vie: SIEMPRE +2 días, salvo el fin de semana (viernes → lunes = +3).
//   Así, en ritmo da L/X/V (2/2/3); si se atrasa, los +2 mantienen ALTA la exposición y re-sincronizan solos.
// - El resto → cada N días fijos.
export function nextMaintDue(item: { category: string; intervalDays?: number | null; specificDates?: string | null }, fromDate: string): string {
  const dates = (parseArr(item.specificDates) as string[]).filter((d) => typeof d === "string").sort();
  if (dates.length > 0) {
    const next = dates.find((d) => d > fromDate);
    return next ?? addDays(fromDate, 7); // agotada la lista acordada → semanal
  }
  if (item.category === "THREE_WEEK" && !(item.intervalDays && item.intervalDays > 0)) {
    return addDays(fromDate, weekdayOfDay(fromDate) === 5 ? 3 : 2); // viernes(5) → lunes; resto → +2
  }
  return addDays(fromDate, maintInterval(item));
}

// Deriva la recurrencia nueva a partir de los campos viejos (usado en el backfill).
export function deriveRecurrence(old: {
  category: string; intervalDays: number | null; doseDays: string | null;
}): { recurrence: string; weekdays: string | null; specificDates: string | null } {
  const hasDoseDays = old.doseDays && old.doseDays !== "[]";
  if (old.category === "WEEKLY") return { recurrence: "WEEKLY", weekdays: null, specificDates: null };
  if (old.category === "BIWEEKLY") return { recurrence: "BIWEEKLY", weekdays: null, specificDates: null };
  if (hasDoseDays) return { recurrence: "SPECIFIC_DATES", weekdays: null, specificDates: old.doseDays! };
  if (old.category === "THREE_WEEK") return { recurrence: "WEEKDAYS", weekdays: JSON.stringify([1, 3, 5]), specificDates: null };
  if (old.intervalDays) return { recurrence: "EVERY_N_DAYS", weekdays: null, specificDates: null };
  return { recurrence: "DAILY", weekdays: null, specificDates: null };
}

// ¿Toca este item ESE día? (solo para items diarios; los de período se generan por período.)
export function isDueOn(item: ItemLike, day: string): boolean {
  if (isPeriodItem(item)) return false;
  if (item.cycleStartDay && day < item.cycleStartDay) return false;
  switch (item.recurrence) {
    case "SPECIFIC_DATES":
      return (parseArr(item.specificDates) as string[]).includes(day);
    case "WEEKDAYS":
      return (parseArr(item.weekdays) as number[]).includes(weekdayOfDay(day));
    case "EVERY_N_DAYS":
      return !!(item.intervalDays && item.anchorDay && isDueToday(item.intervalDays, item.anchorDay, day));
    case "DAILY":
    default:
      return true;
  }
}

// Dosis congelada para un día (resuelve la escalera si corresponde).
export function resolveDose(item: ItemLike, day: string): string {
  const levels = parseArr(item.doseLevels) as string[];
  if (levels.length > 0 && item.cycleStartDay) {
    return levels[doseLevelForDay(item.cycleStartDay, levels.length, day)] ?? item.dose;
  }
  return item.dose;
}

// Clave de período: diario = la fecha; semanal = lunes de la semana; quincenal = índice de quincena.
export function periodKeyFor(item: { recurrence: string }, day: string): string {
  if (item.recurrence === "WEEKLY") return "W:" + mondayOf(day);
  if (item.recurrence === "BIWEEKLY") return "BW:" + biweekIndex(day);
  return day;
}

function biweekIndex(day: string): number {
  return Math.floor(dayDiff(BIWEEK_EPOCH, mondayOf(day)) / 14);
}

// Límites del período que contiene a `day` (para semanal/quincenal).
export function periodBounds(item: { recurrence: string }, day: string): { start: string; end: string } {
  if (item.recurrence === "WEEKLY") { const s = mondayOf(day); return { start: s, end: addDays(s, 6) }; }
  if (item.recurrence === "BIWEEKLY") { const s = addDays(BIWEEK_EPOCH, biweekIndex(day) * 14); return { start: s, end: addDays(s, 13) }; }
  return { start: day, end: day };
}

// dueDate = FIN del período (así una toma "de esta semana" no se marca atrasada hasta que el período termina).
export function periodDueDate(item: { recurrence: string }, day: string): string {
  return periodBounds(item, day).end;
}

// --- Etiquetas de slot estables (por posición) ---
export function slotLabels(n: number): string[] {
  if (n <= 1) return ["único"];
  if (n === 2) return ["mañana", "noche"];
  if (n === 3) return ["mañana", "mediodía", "noche"];
  if (n === 4) return ["mañana", "mediodía", "tarde", "noche"];
  return Array.from({ length: n }, (_, i) => `slot${i + 1}`);
}

function toMin(hhmm: string): number {
  const m = hhmm.match(/(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : 0;
}

// Mapea el "slot" viejo de un Intake ("HH:MM" o "u") al slot nuevo más cercano.
// Devuelve { label, distMin } (distMin = distancia en minutos; grande = revisar).
export function mapOldSlot(oldSlot: string, slots: { label: string; time: string | null }[]): { label: string; distMin: number } {
  if (slots.length === 0) return { label: "único", distMin: 0 };
  if (oldSlot === "u" || slots.every((s) => s.time == null)) {
    const u = slots.find((s) => s.time == null) ?? slots[0];
    return { label: u.label, distMin: 0 };
  }
  const t = toMin(oldSlot);
  let best = slots[0], bestD = Infinity;
  for (const s of slots) {
    if (s.time == null) continue;
    const d = Math.abs(toMin(s.time) - t);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { label: best.label, distMin: bestD };
}
