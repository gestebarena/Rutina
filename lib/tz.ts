// Conversión de horas entre zonas horarias, para que cada admin vea las horas de Nico
// en su propio huso. La LÓGICA (avisos, atrasadas) sigue en la hora local de Nico.

// Zonas horarias frecuentes para elegir en el perfil.
export const COMMON_TZS: { value: string; label: string; code: string }[] = [
  { value: "Europe/Madrid",                    label: "España (Madrid)",              code: "MAD" },
  { value: "Europe/London",                    label: "Reino Unido (Londres)",        code: "LON" },
  { value: "Europe/Helsinki",                  label: "Finlandia (Helsinki)",         code: "HEL" },
  { value: "Europe/Paris",                     label: "Francia (París)",              code: "CDG" },
  { value: "America/New_York",                 label: "EE. UU. Este (Nueva York)",   code: "NYC" },
  { value: "America/Chicago",                  label: "EE. UU. Centro (Chicago)",    code: "ORD" },
  { value: "America/Los_Angeles",              label: "EE. UU. Oeste (Los Ángeles)", code: "LAX" },
  { value: "America/Mexico_City",              label: "México (Ciudad de México)",   code: "MEX" },
  { value: "America/Bogota",                   label: "Colombia (Bogotá)",            code: "BOG" },
  { value: "America/Lima",                     label: "Perú (Lima)",                  code: "LIM" },
  { value: "America/Argentina/Buenos_Aires",   label: "Argentina (Buenos Aires)",    code: "EZE" },
  { value: "America/Santiago",                 label: "Chile (Santiago)",             code: "SCL" },
  { value: "Asia/Tokyo",                       label: "Japón (Tokio)",                code: "TYO" },
  { value: "Asia/Dubai",                       label: "Emiratos (Dubái)",             code: "DXB" },
  { value: "Australia/Sydney",                 label: "Australia (Sídney)",           code: "SYD" },
];

// Devuelve el código corto (tipo aeropuerto) de una zona horaria.
export function tzCode(tz: string): string {
  return COMMON_TZS.find((t) => t.value === tz)?.code ?? tz.split("/").pop() ?? tz;
}

// Desfase (en minutos) de una zona horaria en un instante dado.
function tzOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Convierte una hora "HH:MM" de la zona `fromTz` (en el día `day`) a la zona `toTz`.
export function convertWallTime(hhmm: string, day: string, fromTz: string, toTz: string): string {
  if (fromTz === toTz) return hhmm;
  const [Y, M, D] = day.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  const offFrom = tzOffsetMinutes(fromTz, new Date(guess));
  const instant = new Date(guess - offFrom * 60000); // instante UTC real
  const out = new Intl.DateTimeFormat("en-GB", {
    timeZone: toTz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
  return out;
}

// Convierte una hora "HH:MM" de `tz` en el día `day` a milisegundos UTC.
export function wallTimeToMs(day: string, hhmm: string, tz: string): number {
  const [Y, M, D] = day.split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  const approx = Date.UTC(Y, M - 1, D, h, m);
  const off = tzOffsetMinutes(tz, new Date(approx));
  return approx - off * 60000;
}

// Diferencia horaria (minutos) entre dos zonas hoy: positivo si `toTz` va por delante.
export function offsetDiffMinutes(fromTz: string, toTz: string, date: Date = new Date()): number {
  return tzOffsetMinutes(toTz, date) - tzOffsetMinutes(fromTz, date);
}

export function tzLabel(tz: string): string {
  return COMMON_TZS.find((t) => t.value === tz)?.label ?? tz;
}
