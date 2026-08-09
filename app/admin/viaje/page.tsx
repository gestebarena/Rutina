import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseTimes } from "@/lib/schedule";
import { COMMON_TZS, offsetDiffMinutes, tzLabel } from "@/lib/tz";

export const dynamic = "force-dynamic";

function addMinutes(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default async function ViajePage({ searchParams }: { searchParams: Promise<{ dest?: string; days?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  const { dest, days } = await searchParams;
  const config = await prisma.config.findUnique({ where: { id: 1 } });
  const planTz = config?.planTimezone ?? "Europe/Madrid";

  const nDays = Math.min(14, Math.max(1, parseInt(days || "4", 10) || 4));
  const validDest = dest && COMMON_TZS.some((t) => t.value === dest) ? dest : null;

  let rows: { name: string; times: string[] }[] = [];
  let totalShift = 0;
  if (validDest) {
    totalShift = offsetDiffMinutes(planTz, validDest); // minutos a desplazar en total
    const meds = await prisma.item.findMany({
      where: { active: true, category: "MED" },
      orderBy: { sortOrder: "asc" },
    });
    rows = meds
      .map((it) => ({ name: it.name, base: parseTimes(it.times) }))
      .filter((r) => r.base.length > 0)
      .map((r) => ({
        name: r.name,
        // Para cada día, desplazamos gradualmente hacia el horario del destino.
        times: Array.from({ length: nDays }, (_, i) => {
          const shift = Math.round((totalShift * (i + 1)) / nDays / 15) * 15; // pasos de 15 min
          return r.base.map((t) => addMinutes(t, shift)).join(" · ");
        }),
      }));
  }

  const inputCls = "rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none";

  return (
    <main className="min-h-dvh bg-sky-50 pb-16">
      <header className="bg-sky-700 text-white px-5 pt-6 pb-5 rounded-b-3xl">
        <Link href="/admin" className="text-sky-100 text-sm underline underline-offset-2">← Volver a Administrar</Link>
        <h1 className="text-2xl font-bold mt-2">✈️ Planificar viaje</h1>
        <p className="text-sky-100 text-sm">Sugerencia de horarios que se desplazan poco a poco. No cambia nada del plan.</p>
      </header>

      <div className="px-4 mt-5 space-y-5 max-w-xl mx-auto">
        <form className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Destino</span>
            <select name="dest" defaultValue={validDest ?? ""} className={`mt-1 w-full ${inputCls}`}>
              <option value="">Elige el destino…</option>
              {COMMON_TZS.filter((t) => t.value !== planTz).map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">¿En cuántos días adaptarse?</span>
            <input name="days" type="number" min="1" max="14" defaultValue={nDays} className={`mt-1 w-full ${inputCls}`} />
          </label>
          <button className="w-full rounded-xl bg-sky-600 py-3 text-lg font-semibold text-white">Ver plan</button>
        </form>

        {validDest && (
          <section className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-sm text-slate-600 mb-1">
              Diferencia con {tzLabel(validDest)}: <strong>{totalShift >= 0 ? "+" : ""}{Math.round(totalShift / 60 * 10) / 10} h</strong>.
            </p>
            <p className="text-xs text-slate-400 mb-3">Horas en la hora local de Nico. Cada día se adelanta/atrasa un poco hasta llegar al destino.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-1 pr-2">Medicina</th>
                    {Array.from({ length: nDays }, (_, i) => (
                      <th key={i} className="px-2 py-1 whitespace-nowrap">Día {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2 font-medium text-slate-700">{r.name}</td>
                      {r.times.map((t, i) => (
                        <td key={i} className="px-2 py-1.5 text-center whitespace-nowrap text-slate-600">{t}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className="text-sm text-slate-400">No hay medicinas con hora fija.</p>}
            <p className="text-xs text-slate-400 mt-3">El “Día {nDays}” es ya el horario adaptado al destino. Consúltalo con el médico.</p>
          </section>
        )}
      </div>
    </main>
  );
}
