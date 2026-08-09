// Cálculos de cumplimiento (obligatorias) por día, para historial, resumen y logros.
import { dueSlots, isMust, type SchedItem } from "./schedule";

export type DayStat = { day: string; total: number; taken: number; skipped: number; missed: number };

type Item = SchedItem & { category: string };

// Cuenta las tomas OBLIGATORIAS de un día y cuántas se hicieron/saltaron.
export function mustStats(items: Item[], statusMap: Map<string, string>, day: string): DayStat {
  let total = 0, taken = 0, skipped = 0;
  for (const it of items) {
    if (!isMust(it.category)) continue;
    for (const slot of dueSlots(it, day)) {
      total++;
      const s = statusMap.get(`${it.id}|${day}|${slot}`);
      if (s === "TAKEN") taken++;
      else if (s === "SKIPPED") skipped++;
    }
  }
  return { day, total, taken, skipped, missed: total - taken - skipped };
}

// Un día está "completo" si no queda ninguna obligatoria sin resolver.
export function isDayComplete(st: DayStat): boolean {
  return st.total > 0 && st.missed === 0;
}

// Racha: días seguidos completos terminando en hoy (hoy cuenta solo si está completo).
export function streakEndingToday(items: Item[], statusMap: Map<string, string>, today: string, earliest: string): number {
  let streak = 0;
  let d = today;
  while (d >= earliest) {
    if (isDayComplete(mustStats(items, statusMap, d))) streak++;
    else break;
    // retroceder un día
    const [y, m, dd] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd) - 86400000);
    d = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }
  return streak;
}

// Medallas según la racha.
export const MEDALS: { days: number; icon: string; label: string }[] = [
  { days: 3, icon: "🥉", label: "3 días" },
  { days: 7, icon: "🥈", label: "1 semana" },
  { days: 14, icon: "🥇", label: "2 semanas" },
  { days: 30, icon: "🏆", label: "1 mes" },
];
