// Inventario de medicinas. El stock se guarda en la UNIDAD BASE de cada medicina
// (stockUnit): "mg" (Advagraf, Myfortic...), "pill" (Fero, MagneCit) o "dose" (Saizen).
// Cada toma marcada descuenta `perDose` de esa unidad (ver adjustStock en app/actions.ts).
// Con la recurrencia del plan sabemos cuántas tomas consume Nico al día y, de ahí,
// los días de cobertura que quedan hasta que se acabe.
import { addDays } from "./madrid";
import { maintInterval, isMaintenance } from "./recurrence";

function parseArr(s: string | null | undefined): unknown[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

export type StockItem = {
  category: string;
  recurrence: string; // DAILY | EVERY_N_DAYS | WEEKDAYS | SPECIFIC_DATES | WEEKLY | BIWEEKLY
  intervalDays: number | null;
  weekdays: string | null; // JSON [1,3,5]
  specificDates: string | null; // JSON ["2026-08-07", ...]
  perDose?: number | null; // unidad base consumida por toma (null = 1)
};

// TOMAS por día según la recurrencia y cuántos momentos (slots) tiene al día.
// activeSlots = nº de tomas por día que toca (p.ej. mañana+noche = 2). Para items de período
// (semanal/quincenal) es 1 toma por período.
export function dosesPerDay(item: StockItem, activeSlots: number): number {
  const slots = Math.max(0, activeSlots);
  if (slots === 0) return 0;
  switch (item.recurrence) {
    case "DAILY":
      return slots;
    case "WEEKDAYS": {
      const days = (parseArr(item.weekdays) as number[]).length;
      return days > 0 ? (slots * days) / 7 : 0;
    }
    case "EVERY_N_DAYS":
      return item.intervalDays && item.intervalDays > 0 ? slots / item.intervalDays : slots;
    case "WEEKLY":
      return 1 / 7;
    case "BIWEEKLY":
      return 1 / 14;
    case "SPECIFIC_DATES": {
      // Densidad media de las fechas acordadas (si hay al menos dos, usamos su rango).
      const dates = (parseArr(item.specificDates) as string[]).filter((d) => typeof d === "string").sort();
      if (dates.length >= 2) {
        const span = daysBetween(dates[0], dates[dates.length - 1]);
        return span > 0 ? (dates.length - 1) / span : 0;
      }
      return 0;
    }
    default:
      // Maintenance foods rodantes: 1 toma cada N días.
      if (isMaintenance(item)) return 1 / maintInterval(item);
      return slots;
  }
}

// Consumo medio diario en la UNIDAD BASE del item (mg/día, pastillas/día o tomas/día).
// = perDose × tomas por día. Es lo que se compara con el stock para sacar días de cobertura.
export function unitsPerDay(item: StockItem, activeSlots: number): number {
  const per = item.perDose ?? 1;
  return dosesPerDay(item, activeSlots) * per;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// Días enteros de cobertura que quedan. Infinity si no hay consumo medible.
// stock y upd están en la MISMA unidad base (ambos en mg, o ambos en pastillas, etc.).
export function daysOfSupply(stock: number, unitsPerDayValue: number): number {
  if (unitsPerDayValue <= 0) return Infinity;
  return Math.floor(stock / unitsPerDayValue);
}

// Fecha estimada ("AAAA-MM-DD") en la que se acaba el stock (hoy + días de cobertura).
export function estimatedRunOut(today: string, days: number): string | null {
  if (!Number.isFinite(days)) return null;
  return addDays(today, days);
}

// Umbral efectivo en días para una medicina: su override o, si no, el default global.
export function effectiveThreshold(item: { stockAlertDays: number | null }, config: { stockAlertDays?: number | null } | null): number {
  return item.stockAlertDays ?? config?.stockAlertDays ?? 7;
}

// Presentaciones en mg para cargar/recontar (JSON [5,3,1,0.5]). Vacío = una sola cuenta.
export function presentationsMg(item: { presentations: string | null }): number[] {
  return (parseArr(item.presentations) as unknown[])
    .map((n) => (typeof n === "number" ? n : parseFloat(String(n))))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Etiqueta de la unidad base para mostrar ("mg", "pastillas", "tomas").
export function unitLabel(stockUnit: string | null | undefined, qty: number): string {
  switch (stockUnit) {
    case "mg": return "mg";
    case "pill": return qty === 1 ? "pastilla" : "pastillas";
    case "dose": return qty === 1 ? "toma" : "tomas";
    default: return qty === 1 ? "unidad" : "unidades";
  }
}
