import { wallTimeToMs } from "./tz";

// La hora real de una toma se guarda como "AAAA-MM-DD HH:MM" (hora local de Nico).
// Los registros antiguos guardaban solo "HH:MM"; para esos usamos el día del registro.
export function parseTaken(
  takenTime: string,
  fallbackDay: string,
  planTz: string
): { date: string; time: string; ms: number } {
  const full = takenTime.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
  const date = full ? full[1] : fallbackDay;
  const time = full ? full[2] : takenTime;
  return { date, time, ms: wallTimeToMs(date, time, planTz) };
}

// Normaliza un valor de selector "AAAA-MM-DDTHH:MM" a "AAAA-MM-DD HH:MM", o null si no vale.
export function normalizeWhen(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value) ? value.replace("T", " ") : null;
}
