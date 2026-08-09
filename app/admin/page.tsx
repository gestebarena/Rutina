import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { setTimezone } from "../actions";
import { COMMON_TZS } from "@/lib/tz";

const SECTIONS: { key: string; title: string }[] = [
  { key: "MED", title: "💊 Medicinas" },
  { key: "MAINTENANCE", title: "🥣 Maintenance foods (diario, mañana)" },
  { key: "THREE_WEEK", title: "📅 Maintenance foods (3x semana)" },
  { key: "WEEKLY", title: "🗓️ Maintenance foods (semanal)" },
  { key: "BIWEEKLY", title: "🗓️ Maintenance foods (cada 2 semanas)" },
  { key: "TREATMENT", title: "🌅 Treatment foods (tarde)" },
];

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  const [items, viewer] = await Promise.all([
    prisma.item.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
    prisma.user.findUnique({ where: { id: session.userId } }),
  ]);

  return (
    <main className="min-h-dvh bg-sky-50 pb-16">
      <header className="bg-sky-700 text-white px-5 pt-6 pb-5 rounded-b-3xl">
        <Link href="/" className="text-sky-100 text-sm underline underline-offset-2">← Volver a Hoy</Link>
        <h1 className="text-2xl font-bold mt-2">Administrar</h1>
        <p className="text-sky-100 text-sm">Editar dosis, reglas y la semana del ciclo.</p>
      </header>

      <div className="px-4 mt-5 space-y-6 max-w-xl mx-auto">
        <section className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-1">🌍 Tu zona horaria</h2>
          <p className="text-xs text-slate-400 mb-2">Verás las horas del plan en esta zona. Nico las ve en la suya.</p>
          <form action={setTimezone} className="flex items-end gap-3">
            <select name="timezone" defaultValue={viewer?.timezone ?? ""} className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none">
              <option value="">Igual que Nico</option>
              {COMMON_TZS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button className="rounded-xl bg-sky-600 px-5 py-3 font-semibold text-white">Guardar</button>
          </form>
          <Link href="/admin/viaje" className="inline-block mt-3 text-sky-700 text-sm font-medium">✈️ Planificar un viaje (ajuste de horas) ›</Link>
        </section>

        <p className="text-sm text-slate-500 bg-white rounded-2xl p-4">
          Los treatment foods suben de dosis solos al cumplir sus tomas. Para forzar o corregir el nivel,
          edita el alérgeno y mira el apartado <strong>“Escalera de dosis”</strong>.
        </p>

        {SECTIONS.map((s) => {
          const list = items.filter((it) => it.category === s.key);
          return (
            <section key={s.key}>
              <div className="flex items-center justify-between px-1 mb-2">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{s.title}</h2>
                <Link href={`/admin/nuevo?cat=${s.key}`} className="text-sky-700 text-sm font-medium">+ Añadir</Link>
              </div>
              <div className="space-y-2">
                {list.map((it) => (
                  <Link
                    key={it.id}
                    href={`/admin/item/${it.id}`}
                    className={`flex items-center justify-between rounded-2xl border p-3 ${
                      it.active ? "bg-white border-slate-200" : "bg-slate-100 border-slate-200 opacity-70"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-800">{it.name}</span>
                      <span className="block text-sm text-slate-500">
                        {it.dose} · {it.frequency}
                        {!it.active && " · (oculto)"}
                      </span>
                    </span>
                    <span className="text-sky-700 text-sm shrink-0 ml-2">Editar ›</span>
                  </Link>
                ))}
                {list.length === 0 && <p className="text-sm text-slate-400 px-1">Nada todavía.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
