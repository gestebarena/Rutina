"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6 bg-sky-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-sky-700">Rutina</h1>
          <p className="text-slate-500 mt-1">Las tomas de Nico, ordenadas.</p>
        </div>
        <form action={formAction} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Usuario</span>
            <input
              name="username"
              autoCapitalize="none"
              autoComplete="username"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none"
              placeholder="amancaya, gonzalo o nico"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Contraseña</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-sky-500 focus:outline-none"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-sky-600 py-3 text-lg font-semibold text-white active:bg-sky-700 disabled:opacity-60"
          >
            {pending ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
