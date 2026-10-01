import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { madridDay } from "@/lib/madrid";
import { unitsPerDay, daysOfSupply, estimatedRunOut, effectiveThreshold, presentationsMg, unitLabel } from "@/lib/stock";
import { setStockLevel, setItemStockAlertDays, setGlobalStockAlertDays } from "../../actions";

const inputCls = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none";

// "2026-10-08" → "mié 8 oct"
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

// "180 mg/día", "6 pastillas/día", "cada 2 días", "7 mg/día"
function fmtRate(upd: number, unit: string | null): string {
  if (upd <= 0) return "—";
  const u = unitLabel(unit, upd);
  if (upd >= 1) return `${Number.isInteger(upd) ? upd : upd.toFixed(2).replace(".", ",")} ${u}/día`;
  const every = Math.round(1 / upd);
  return `cada ${every} días`;
}

// "0,5" → "0,5", "5" → "5" (mg con coma decimal)
function fmtMg(mg: number): string {
  return Number.isInteger(mg) ? String(mg) : mg.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

export default async function InventarioPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  const today = madridDay();
  const [meds, config] = await Promise.all([
    prisma.item.findMany({
      where: { category: "MED" },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: { slots: { where: { active: true } } },
    }),
    prisma.config.findUnique({ where: { id: 1 } }),
  ]);
  const globalDays = config?.stockAlertDays ?? 7;

  const rows = meds.map((it) => {
    const tracked = it.stock !== null && it.stock !== undefined;
    const upd = unitsPerDay(it, it.slots.length); // consumo diario en unidad base
    const days = tracked ? daysOfSupply(it.stock as number, upd) : null;
    const threshold = effectiveThreshold(it, config);
    const low = days !== null && Number.isFinite(days) && days <= threshold;
    const runOut = days !== null ? estimatedRunOut(today, days) : null;
    const strengths = presentationsMg(it); // [] = cuenta única (pastillas/tomas)
    return { it, tracked, upd, days, threshold, low, runOut, strengths };
  });

  return (
    <main className="min-h-dvh bg-sky-50 pb-16">
      <header className="bg-sky-700 text-white px-5 pt-6 pb-5 rounded-b-3xl">
        <Link href="/admin" className="text-sky-100 text-sm underline underline-offset-2">← Volver a Administrar</Link>
        <h1 className="text-2xl font-bold mt-2">📦 Inventario</h1>
        <p className="text-sky-100 text-sm">Cuánto queda de cada medicina y aviso cuando falte poco.</p>
      </header>

      <div className="px-4 mt-5 space-y-6 max-w-xl mx-auto">
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-1">⏰ Avisar por defecto</h2>
          <p className="text-xs text-slate-400 mb-3">Mandamos un aviso a mamá y papá cuando a una medicina le falten estos días o menos. Puedes ajustarlo por medicina más abajo.</p>
          <form action={setGlobalStockAlertDays} className="flex items-end gap-3">
            <label className="block flex-1">
              <span className="text-xs font-medium text-slate-700">Días de antelación</span>
              <input name="stockAlertDays" type="number" min="1" defaultValue={globalDays} className={inputCls} />
            </label>
            <button className="rounded-xl bg-sky-600 px-5 py-2 font-semibold text-white">Guardar</button>
          </form>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide px-1">💊 Medicinas</h2>
          {rows.length === 0 && <p className="text-sm text-slate-400 px-1">No hay medicinas.</p>}

          {rows.map(({ it, tracked, upd, days, threshold, low, runOut, strengths }) => (
            <div key={it.id} className={`rounded-2xl border p-4 ${it.active ? "bg-white border-slate-200" : "bg-slate-100 border-slate-200 opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800">{it.name}</span>
                  <span className="block text-sm text-slate-500">{it.dose} · {it.frequency}{!it.active && " · (oculto)"}</span>
                </div>
                {tracked ? (
                  days !== null && Number.isFinite(days) ? (
                    <span className={`text-xs font-medium rounded-full px-2 py-0.5 shrink-0 ${low ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      ~{days} {days === 1 ? "día" : "días"}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 shrink-0">sin consumo</span>
                  )
                ) : (
                  <span className="text-xs text-slate-400 shrink-0">sin controlar</span>
                )}
              </div>

              {tracked && (
                <p className="text-xs text-slate-500 mt-2">
                  Quedan <strong>{fmtMg(it.stock as number)} {unitLabel(it.stockUnit, it.stock as number)}</strong> · consumo {fmtRate(upd, it.stockUnit)}
                  {runOut && <> · se acaba ~<strong>{fmtDate(runOut)}</strong></>}
                </p>
              )}

              {/* Carga / recuento (reality-check): por presentación en mg, o una cuenta única. */}
              <form action={setStockLevel} className="mt-3">
                <input type="hidden" name="itemId" value={it.id} />
                {strengths.length > 0 ? (
                  <>
                    <span className="text-xs font-medium text-slate-700">Cuántas pastillas tenés de cada presentación</span>
                    <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {strengths.map((mg, i) => (
                        <label key={mg} className="block">
                          <span className="text-xs text-slate-500">{fmtMg(mg)} mg</span>
                          <input name={`c_${i}`} type="number" min="0" className={inputCls} placeholder="0" />
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">Al guardar se suman los mg totales. Recontá y volvé a cargar cuando quieras ajustar lo real.</p>
                  </>
                ) : (
                  <label className="block">
                    <span className="text-xs font-medium text-slate-700">
                      {it.stockUnit === "dose" ? "Tomas que quedan" : "Pastillas que quedan"}
                    </span>
                    <input name="stock" type="number" min="0" step="any" defaultValue={it.stock ?? ""} className={inputCls} placeholder="vacío = no controlar" />
                  </label>
                )}
                <button className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">Guardar inventario</button>
              </form>

              <form action={setItemStockAlertDays} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="itemId" value={it.id} />
                <label className="block flex-1">
                  <span className="text-xs font-medium text-slate-700">Avisar a {threshold} días</span>
                  <input name="stockAlertDays" type="number" min="1" defaultValue={it.stockAlertDays ?? ""} className={inputCls} placeholder={`global (${globalDays})`} />
                </label>
                <button className="rounded-xl bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Guardar</button>
              </form>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
