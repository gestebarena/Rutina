// Utilidades de fecha/hora ancladas a la hora de Madrid ("MAD" en el plan).
// En el Paso 1 usamos siempre Madrid; el manejo de viajes/husos llega en el Paso 3.

const TZ = "Europe/Madrid";

// Devuelve la fecha de HOY en Madrid como "AAAA-MM-DD".
export function madridDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts; // en-CA da "AAAA-MM-DD"
}

// Día de la semana en Madrid: 0 = domingo ... 6 = sábado.
export function madridWeekday(date: Date = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

// Diferencia en días enteros entre dos fechas "AAAA-MM-DD" (b - a).
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

// ¿Toca hoy un item que se toma cada `intervalDays` días, anclado en `anchorDay`?
export function isDueToday(intervalDays: number, anchorDay: string, today: string = madridDay()): boolean {
  const diff = dayDiff(anchorDay, today);
  return ((diff % intervalDays) + intervalDays) % intervalDays === 0;
}

// Día de la semana de una fecha "AAAA-MM-DD": 0 = domingo ... 6 = sábado.
export function weekdayOfDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Suma (o resta) días a una fecha "AAAA-MM-DD".
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// Lunes de la semana de esa fecha (semana de lunes a domingo).
export function mondayOf(day: string): string {
  const w = weekdayOfDay(day); // 0=domingo
  const offset = (w + 6) % 7; // lunes=0
  return addDays(day, -offset);
}

// Hora actual de Madrid como "HH:MM".
export function nowMadridHHMM(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// Texto corto de un día: "lun 30 jun".
export function shortDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Texto bonito de la fecha de hoy, p.ej. "martes, 30 de junio".
export function madridDayLabel(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}
