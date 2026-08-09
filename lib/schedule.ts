// Lógica de "¿qué toca cada día?" para Rutina.
import { isDueToday, weekdayOfDay, dayDiff } from "./madrid";

// Nivel actual de la escalera de dosis según la FECHA (sube solo cada 7 días desde cycleStartDay).
export function doseLevelForDay(cycleStartDay: string | null, levelsLen: number, day: string): number {
  if (!cycleStartDay || levelsLen <= 0) return 0;
  const weeks = Math.floor(dayDiff(cycleStartDay, day) / 7);
  return Math.min(Math.max(weeks, 0), levelsLen - 1);
}

export type SchedItem = {
  id: string;
  category: string;
  times: string; // JSON: ["07:30", ...]
  intervalDays: number | null;
  anchorDay: string | null;
  cycleStartDay?: string | null; // treatment foods: no "toca" antes de esta fecha
  doseDays?: string | null; // JSON de días concretos; si hay, solo toca en esos días
};

const MWF = [1, 3, 5]; // lunes, miércoles, viernes

export function parseTimes(times: string): string[] {
  try {
    const t = JSON.parse(times || "[]");
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

// Las "tomas" (slots) de un item: sus horas, o ["u"] si no tiene hora.
export function slotsOf(item: SchedItem): string[] {
  const t = parseTimes(item.times);
  return t.length > 0 ? t : ["u"];
}

// ¿Qué tomas tocan ESE día? Devuelve los slots, o [] si ese día no toca.
// WEEKLY no entra aquí (se trata aparte: se puede hacer cualquier día de la semana).
export function dueSlots(item: SchedItem, day: string): string[] {
  if (item.category === "WEEKLY" || item.category === "BIWEEKLY") return [];
  if (item.cycleStartDay && day < item.cycleStartDay) return []; // aún no empezó su ciclo
  // Días concretos (p.ej. yema en su transición): solo toca en esas fechas.
  if (item.doseDays && item.doseDays !== "[]") {
    let days: string[] = [];
    try { days = JSON.parse(item.doseDays); } catch { days = []; }
    if (days.length > 0) return days.includes(day) ? slotsOf(item) : [];
  }
  if (item.intervalDays && item.anchorDay && !isDueToday(item.intervalDays, item.anchorDay, day)) {
    return [];
  }
  if (item.category === "THREE_WEEK") {
    return MWF.includes(weekdayOfDay(day)) ? slotsOf(item) : [];
  }
  // MED, MAINTENANCE, TREATMENT diarios
  return slotsOf(item);
}

// ¿Es una toma OBLIGATORIA (MUST) del día?
// MUST = medicinas + alérgenos de la mañana + treatment foods + 3xsemana en su día (L/X/V).
export function isMust(category: string): boolean {
  return category === "MED" || category === "MAINTENANCE" || category === "TREATMENT" || category === "THREE_WEEK";
}
