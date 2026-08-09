import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { addDays, mondayOf, shortDayLabel } from "@/lib/madrid";

const MUST_CATS = new Set(["MED", "MAINTENANCE", "THREE_WEEK", "TREATMENT"]);
type Stat = { total: number; taken: number; skipped: number; missed: number };

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const config = await prisma.config.findUnique({ where: { id: 1 } });
  const planTz = config?.planTimezone ?? "Europe/Madrid";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: planTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const trackingStart = config?.trackingStart ?? today;
  const from = trackingStart > addDays(today, -20) ? trackingStart : addDays(today, -20);
  const weekStart = mondayOf(today);

  const [items, occs] = await Promise.all([
    prisma.item.findMany({ where: { active: true } }),
    prisma.doseOccurrence.findMany({ where: { dueDate: { gte: from, lte: today } } }),
  ]);
  const itemById = new Map(items.map((it) => [it.id, it]));
  // Estadística por día: solo tomas obligatorias diarias.
  const byDay = new Map<string, Stat>();
  for (const o of occs) {
    const it = itemById.get(o.itemId);
    if (!it || !MUST_CATS.has(it.category)) continue;
    const s = byDay.get(o.dueDate) ?? { total: 0, taken: 0, skipped: 0, missed: 0 };
    s.total++;
    if (o.status === "TAKEN") s.taken++;
    else if (o.status === "SKIPPED") s.skipped++;
    byDay.set(o.dueDate, s);
  }
  const stat = (d: string): Stat => {
    const s = byDay.get(d) ?? { total: 0, taken: 0, skipped: 0, missed: 0 };
    return { ...s, missed: s.total - s.taken - s.skipped };
  };

  // Lista de días (más reciente primero).
  const days: string[] = [];
  for (let d = today; d >= from; d = addDays(d, -1)) days.push(d);

  // Resumen de esta semana (lunes → hoy).
  let wTotal = 0, wTaken = 0, wSkipped = 0, wMissed = 0;
  for (let d = weekStart; d <= today; d = addDays(d, 1)) {
    const st = stat(d);
    wTotal += st.total; wTaken += st.taken; wSkipped += st.skipped; wMissed += st.missed;
  }
  const wPct = wTotal > 0 ? Math.round((wTaken / wTotal) * 100) : 0;

  return (
    <main className="min-h-dvh bg-sky-50 pb-16">
      <header className="bg-sky-700 text-white px-5 pt-6 pb-5 rounded-b-3xl">
        <Link href="/" className="text-sky-100 text-sm underline underline-offset-2">← Volver a Hoy</Link>
        <h1 className="text-2xl font-bold mt-2">Historial</h1>
      </header>

      <div className="px-4 mt-5 space-y-6 max-w-xl mx-auto">
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-semibold text-slate-800">📊 Esta semana</h2>
          <p className="text-3xl font-bold text-sky-700 mt-1">{wPct}%</p>
          <p className="text-sm text-slate-500">{wTaken} de {wTotal} tomas obligatorias hechas</p>
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-slate-500">⏭️ {wSkipped} saltadas</span>
            <span className={wMissed > 0 ? "text-red-600" : "text-slate-500"}>⚠️ {wMissed} sin marcar</span>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide px-1 mb-2">Día a día</h2>
          <div className="space-y-2">
            {days.map((d) => {
              const st = stat(d);
              const pct = st.total > 0 ? Math.round((st.taken / st.total) * 100) : 0;
              const perfect = st.total > 0 && st.missed === 0;
              return (
                <div key={d} className="bg-white rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-700 capitalize">
                      {shortDayLabel(d)}{d === today ? " · hoy" : ""}
                    </span>
                    <span className={`text-sm font-semibold ${perfect ? "text-emerald-600" : st.missed > 0 ? "text-red-600" : "text-slate-500"}`}>
                      {st.taken}/{st.total} {perfect ? "✓" : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  {(st.skipped > 0 || st.missed > 0) && (
                    <div className="flex gap-3 mt-1.5 text-xs text-slate-400">
                      {st.skipped > 0 && <span>⏭️ {st.skipped} saltadas</span>}
                      {st.missed > 0 && d !== today && <span className="text-red-500">⚠️ {st.missed} sin marcar</span>}
                      {st.missed > 0 && d === today && <span>⏳ {st.missed} pendientes</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
