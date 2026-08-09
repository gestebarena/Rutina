import Link from "next/link";
import { saveItem, deleteItem } from "../actions";

type Item = {
  id: string;
  name: string;
  dose: string;
  category: string;
  frequency: string;
  times: string;
  rule: string | null;
  capped: boolean;
  active: boolean;
  intervalDays: number | null;
  anchorDay: string | null;
  doseLevels: string;
  cycleStartDay: string | null;
  stock: number | null;
  stockAlertAt: number | null;
  sortOrder: number;
};

function levelsToText(doseLevels: string): string {
  try {
    const t = JSON.parse(doseLevels || "[]");
    return Array.isArray(t) ? t.join("\n") : "";
  } catch {
    return "";
  }
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "MED", label: "💊 Medicina" },
  { value: "MAINTENANCE", label: "🥣 Maintenance foods (diario, mañana)" },
  { value: "THREE_WEEK", label: "📅 Maintenance foods (3x semana)" },
  { value: "BIWEEKLY", label: "🗓️ Maintenance foods (cada 2 semanas)" },
  { value: "TREATMENT", label: "🌅 Treatment food (tarde)" },
  { value: "WEEKLY", label: "🗓️ Maintenance foods (semanal)" },
];

function timesToText(times: string): string {
  try {
    const t = JSON.parse(times || "[]");
    return Array.isArray(t) ? t.join(", ") : "";
  } catch {
    return "";
  }
}

const inputCls = "mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none";

export default function ItemForm({ item, defaultCategory }: { item?: Item; defaultCategory?: string }) {
  return (
    <div className="max-w-md mx-auto">
      <Link href="/admin" className="text-sky-700 text-sm underline underline-offset-2">← Volver a Administrar</Link>
      <h1 className="text-2xl font-bold text-sky-700 mt-3 mb-5">{item ? "Editar" : "Añadir"}</h1>

      <form action={saveItem} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        {item && <input type="hidden" name="id" value={item.id} />}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nombre</span>
          <input name="name" defaultValue={item?.name} required className={inputCls} placeholder="Ej. Advagraf" />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Dosis</span>
          <input name="dose" defaultValue={item?.dose} className={inputCls} placeholder="Ej. 7 mg" />
          <span className="text-xs text-slate-400">Para treatment foods con escalera, la dosis sale de la escalera de abajo.</span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Sección</span>
          <select name="category" defaultValue={item?.category ?? defaultCategory ?? "MED"} className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Frecuencia (texto)</span>
          <input name="frequency" defaultValue={item?.frequency} className={inputCls} placeholder="Ej. cada 24 h" />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Horas</span>
          <input name="times" defaultValue={item ? timesToText(item.times) : ""} className={inputCls} placeholder="Ej. 07:30, 19:30" />
          <span className="text-xs text-slate-400">Separadas por coma. Déjalo vacío si no tiene una hora fija.</span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Regla o nota (opcional)</span>
          <textarea name="rule" defaultValue={item?.rule ?? ""} rows={2} className={inputCls} placeholder="Ej. 2 h de ayuno antes y 1 h después" />
        </label>

        <label className="flex items-center gap-3">
          <input type="checkbox" name="capped" defaultChecked={item?.capped} className="h-5 w-5" />
          <span className="text-sm text-slate-700">Tiene tope (no exceder)</span>
        </label>

        <details className="rounded-xl bg-slate-50 p-3" open={!!item && item.stock !== null}>
          <summary className="text-sm font-medium text-slate-700 cursor-pointer">📦 Stock (opcional)</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Tomas que quedan</span>
              <input name="stock" type="number" min="0" defaultValue={item?.stock ?? ""} className={inputCls} placeholder="vacío = no controlar" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Avisar cuando queden</span>
              <input name="stockAlertAt" type="number" min="0" defaultValue={item?.stockAlertAt ?? ""} className={inputCls} placeholder="ej. 7" />
            </label>
          </div>
          <p className="text-xs text-slate-400 mt-1">Cada toma marcada descuenta 1. Cuando quede poco, saldrá un aviso.</p>
        </details>

        <details className="rounded-xl bg-amber-50 p-3" open={!!item && levelsToText(item.doseLevels).length > 0}>
          <summary className="text-sm font-medium text-slate-700 cursor-pointer">Escalera de dosis (treatment foods)</summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Dosis por semana (una por línea, en orden)</span>
              <textarea name="doseLevels" defaultValue={item ? levelsToText(item.doseLevels) : ""} rows={5} className={inputCls} placeholder={"1 mg\n2.5 mg\n5 mg\n..."} />
              <span className="text-xs text-slate-400">Déjalo vacío si la dosis es fija.</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Inicio del ciclo (lunes de la semana 1)</span>
              <input name="cycleStartDay" type="date" defaultValue={item?.cycleStartDay ?? ""} className={inputCls} />
              <span className="text-xs text-slate-400">La escalera sube sola cada lunes desde esta fecha. Para retrasar una semana (fiebre), muévela +7 días.</span>
            </label>
          </div>
        </details>

        <details className="rounded-xl bg-slate-50 p-3">
          <summary className="text-sm font-medium text-slate-700 cursor-pointer">Avanzado (días alternos / orden)</summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">¿Cada cuántos días?</span>
              <input name="intervalDays" type="number" min="1" defaultValue={item?.intervalDays ?? ""} className={inputCls} placeholder="Vacío = diario · 2 = días alternos" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Próximo día que sí toca</span>
              <input name="anchorDay" type="date" defaultValue={item?.anchorDay ?? ""} className={inputCls} />
              <span className="text-xs text-slate-400">Solo si pusiste días alternos.</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Orden en la lista</span>
              <input name="sortOrder" type="number" defaultValue={item?.sortOrder ?? 0} className={inputCls} />
            </label>
          </div>
        </details>

        <label className="flex items-center gap-3">
          <input type="checkbox" name="active" defaultChecked={item ? item.active : true} className="h-5 w-5" />
          <span className="text-sm text-slate-700">Activo (se muestra en la app)</span>
        </label>

        <button type="submit" className="w-full rounded-xl bg-sky-600 py-3 text-lg font-semibold text-white active:bg-sky-700">
          Guardar
        </button>
      </form>

      {item && (
        <form action={deleteItem} className="mt-4">
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" className="w-full rounded-xl border border-red-300 py-3 font-medium text-red-700">
            Eliminar definitivamente
          </button>
        </form>
      )}
    </div>
  );
}
