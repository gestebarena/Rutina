"use client";

import Link from "next/link";
import { useActionState } from "react";
import { changePassword, type ChangeResult } from "../actions";

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState<ChangeResult, FormData>(changePassword, {});

  return (
    <main className="min-h-dvh bg-sky-50 p-6">
      <div className="max-w-sm mx-auto">
        <Link href="/" className="text-sky-700 text-sm underline underline-offset-2">← Volver</Link>
        <h1 className="text-2xl font-bold text-sky-700 mt-3 mb-1">Cambiar contraseña</h1>
        <p className="text-slate-500 text-sm mb-5">Solo cambia la tuya. Cada persona entra con su usuario.</p>

        {state.ok ? (
          <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 text-center">
            <p className="text-emerald-800 font-semibold">✓ ¡Contraseña cambiada!</p>
            <p className="text-emerald-700 text-sm mt-1">La próxima vez entra con la nueva.</p>
            <Link href="/" className="inline-block mt-4 rounded-xl bg-sky-600 px-5 py-2 text-white font-medium">
              Volver a Hoy
            </Link>
          </div>
        ) : (
          <form action={formAction} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
            <Field name="current" label="Contraseña actual" />
            <Field name="next" label="Nueva contraseña (mínimo 6)" />
            <Field name="repeat" label="Repite la nueva contraseña" />
            {state.error && <p className="text-sm text-red-600">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-sky-600 py-3 text-lg font-semibold text-white active:bg-sky-700 disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type="password"
        autoComplete="off"
        className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none"
      />
    </label>
  );
}
