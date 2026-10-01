"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { normalizeWhen } from "@/lib/taken";
import { madridDay, addDays } from "@/lib/madrid";
import { deriveRecurrence, slotLabels, isMaintenance, nextMaintDue } from "@/lib/recurrence";
import { regenerateFuture, ensureGenerated, createMaintenanceNext, ensureMaintenanceRolling } from "@/lib/generate";
import { presentationsMg } from "@/lib/stock";

function dayOf(takenTime: string | null, fallback: string): string {
  return takenTime && /^\d{4}-\d{2}-\d{2}/.test(takenTime) ? takenTime.slice(0, 10) : fallback;
}

// Tras resolver (tomar/saltar) un maintenance food, crea su PRÓXIMA toma rodante.
// baseDate = desde qué fecha contar la frecuencia (según "ajustar plan" o "solo esta toma").
async function rollNextMaintenance(occ: { itemId: string; dueDate: string }, baseDate: string) {
  const item = await prisma.item.findUnique({ where: { id: occ.itemId } });
  if (!item || !isMaintenance(item)) return;
  await createMaintenanceNext(prisma, item, nextMaintDue(item, baseDate));
}

// Guarda la suscripción de avisos de este móvil para el usuario actual.
export async function savePushSub(sub: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  await prisma.pushSub.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: session.userId, p256dh: sub.p256dh, auth: sub.auth },
    create: { userId: session.userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
  });
}

export async function removePushSub(endpoint: string): Promise<void> {
  await prisma.pushSub.deleteMany({ where: { endpoint } });
}

// Bitácora append-only.
async function audit(actorId: string | null, action: string, entity: string, entityId: string, detail?: any) {
  await prisma.auditLog.create({ data: { actorId, action, entity, entityId, detail: detail ? JSON.stringify(detail) : null } });
}

// Descuenta (o repone) stock al marcar/desmarcar una toma, en la UNIDAD BASE del item.
// delta = ±1 toma; se multiplica por perDose (mg/toma, pastillas/toma o 1) para saber cuánto mover.
// Advagraf resta 7 mg por toma, MagneCit 2 pastillas, Saizen 1 toma, etc. (ver lib/stock.ts).
async function adjustStock(itemId: string, delta: number): Promise<void> {
  const it = await prisma.item.findUnique({ where: { id: itemId } });
  if (!it || it.stock === null || it.stock === undefined) return;
  const per = it.perDose ?? 1;
  await prisma.item.update({ where: { id: itemId }, data: { stock: Math.max(0, it.stock + delta * per) } });
}

// Cambia solo DÓNDE ESTÁ NICO (no toca el plan). Ajusta cómo se ven las horas.
export async function setNicoLocation(tz: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const valid = ["Europe/Madrid", "Europe/Helsinki", "America/Los_Angeles"].includes(tz);
  if (!valid) return;
  await prisma.config.upsert({ where: { id: 1 }, update: { nicoTimezone: tz }, create: { id: 1, nicoTimezone: tz } });
  revalidatePath("/");
}

// Guarda la zona horaria en la que este usuario quiere ver las horas.
export async function setTimezone(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const tz = String(formData.get("timezone") || "").trim();
  await prisma.user.update({ where: { id: session.userId }, data: { timezone: tz || null } });
  revalidatePath("/");
  redirect("/admin");
}

async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");
  return session;
}

// Convierte "07:30, 19:30" en JSON ["07:30","19:30"], ignorando lo que no sea hora válida.
function parseTimesInput(raw: string): string {
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    .map((s) => (s.length === 4 ? "0" + s : s));
  return JSON.stringify(list);
}

// Sincroniza los ItemSlot (identidad estable por etiqueta) con la lista de horas.
// Cambiar la hora actualiza slot.time SIN cambiar el id (las occurrences pasadas siguen enganchadas).
async function syncSlots(itemId: string, timesJson: string) {
  let times: string[] = [];
  try { times = JSON.parse(timesJson || "[]"); } catch { times = []; }
  const labels = slotLabels(times.length);
  const keep = new Set(labels);
  for (let i = 0; i < labels.length; i++) {
    const time = times.length === 0 ? null : (times[i] ?? null);
    const ex = await prisma.itemSlot.findUnique({ where: { itemId_label: { itemId, label: labels[i] } } });
    if (ex) await prisma.itemSlot.update({ where: { id: ex.id }, data: { time, active: true, sortOrder: i } });
    else await prisma.itemSlot.create({ data: { itemId, label: labels[i], time, sortOrder: i } });
  }
  // Slots que ya no existen en el plan → inactivos (no se borran para conservar el historial).
  await prisma.itemSlot.updateMany({ where: { itemId, label: { notIn: [...keep] } }, data: { active: false } });
}

// Guarda un item: crea uno nuevo (sin id) o actualiza el existente (con id). Solo admin.
export async function saveItem(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = String(formData.get("id") || "").trim();
  const intervalRaw = String(formData.get("intervalDays") || "").trim();
  const anchorRaw = String(formData.get("anchorDay") || "").trim();

  const levels = String(formData.get("doseLevels") || "")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const cycleRaw = String(formData.get("cycleStartDay") || "").trim();
  const cycleStartDay = /^\d{4}-\d{2}-\d{2}$/.test(cycleRaw) ? cycleRaw : null;
  const dose = levels.length > 0 ? levels[0] : String(formData.get("dose") || "").trim();
  const category = String(formData.get("category") || "MED");
  const intervalDays = intervalRaw ? Math.max(1, parseInt(intervalRaw, 10)) : null;
  const timesJson = parseTimesInput(String(formData.get("times") || ""));

  const data = {
    name: String(formData.get("name") || "").trim(),
    dose,
    category,
    frequency: String(formData.get("frequency") || "").trim(),
    times: timesJson,
    rule: String(formData.get("rule") || "").trim() || null,
    capped: formData.get("capped") === "on",
    active: formData.get("active") === "on",
    intervalDays,
    anchorDay: /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw) ? anchorRaw : null,
    doseLevels: JSON.stringify(levels),
    cycleStartDay,
    sortOrder: parseInt(String(formData.get("sortOrder") || "0"), 10) || 0,
  };
  // Nota: el stock y el umbral de aviso NO se tocan aquí; se gestionan en 📦 Inventario
  // (así editar una medicina nunca pisa la cantidad cargada por el admin).

  let itemId = id;
  if (id) {
    const cur = await prisma.item.findUnique({ where: { id } });
    const rec = deriveRecurrence({ category, intervalDays, doseDays: cur?.doseDays ?? null });
    await prisma.item.update({ where: { id }, data: { ...data, ...rec } });
  } else {
    const rec = deriveRecurrence({ category, intervalDays, doseDays: null });
    const created = await prisma.item.create({ data: { ...data, ...rec } });
    itemId = created.id;
  }
  await syncSlots(itemId, timesJson);
  await audit(session.userId, id ? "EDIT_ITEM" : "CREATE_ITEM", "item", itemId, { name: data.name });
  // Regenera el futuro con los valores nuevos (pasado y marcadas intactos).
  await regenerateFuture(prisma, itemId, madridDay());
  revalidatePath("/");
  revalidatePath("/admin");
  redirect("/admin");
}

export async function deleteItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") || "").trim();
  if (id) await prisma.item.delete({ where: { id } }); // cascada borra slots y occurrences
  revalidatePath("/");
  redirect("/admin");
}

// --- Inventario (solo admin) ---

function revalidateInventario() {
  revalidatePath("/admin/inventario");
  revalidatePath("/");
}

// Carga/recuento del stock de una medicina (carga inicial o reality-check al recontar).
// Medicinas en mg: llegan las cantidades por presentación (c_0, c_1... en el orden de
// item.presentations) y se suma strength×cantidad → mg totales. Resto: una cuenta única
// en "stock" (pastillas o tomas). Un campo vacío/sin cantidades = dejar de controlar (null).
export async function setStockLevel(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const itemId = String(formData.get("itemId") || "").trim();
  if (!itemId) return;
  const it = await prisma.item.findUnique({ where: { id: itemId } });
  if (!it) return;
  const strengths = presentationsMg(it);

  let stock: number | null;
  let detail: Record<string, unknown>;
  if (strengths.length > 0) {
    // Por presentación: sumamos mg. Si no se cargó ninguna cantidad, dejamos de controlar.
    const counts = strengths.map((_, i) => Math.max(0, parseInt(String(formData.get(`c_${i}`) || ""), 10) || 0));
    const total = strengths.reduce((acc, mg, i) => acc + mg * counts[i], 0);
    const any = counts.some((n) => n > 0) || strengths.some((_, i) => String(formData.get(`c_${i}`) || "").trim() !== "");
    stock = any ? total : null;
    detail = { mode: "mg", counts: Object.fromEntries(strengths.map((mg, i) => [mg, counts[i]])), total };
  } else {
    const raw = String(formData.get("stock") || "").trim();
    stock = raw === "" ? null : Math.max(0, parseFloat(raw) || 0);
    detail = { mode: it.stockUnit ?? "count", stock };
  }
  await prisma.item.update({ where: { id: itemId }, data: { stock } });
  await audit(session.userId, "SET_STOCK", "item", itemId, detail);
  revalidateInventario();
}

// Fija el umbral de aviso en DÍAS para una medicina concreta (vacío = usar el default global).
export async function setItemStockAlertDays(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const itemId = String(formData.get("itemId") || "").trim();
  if (!itemId) return;
  const raw = String(formData.get("stockAlertDays") || "").trim();
  const stockAlertDays = raw === "" ? null : Math.max(1, parseInt(raw, 10) || 1);
  await prisma.item.update({ where: { id: itemId }, data: { stockAlertDays } });
  await audit(session.userId, "SET_STOCK_ALERT_DAYS", "item", itemId, { stockAlertDays });
  revalidateInventario();
}

// Fija el default global de aviso en días (Config, fila id=1).
export async function setGlobalStockAlertDays(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const days = Math.max(1, parseInt(String(formData.get("stockAlertDays") || "7"), 10) || 7);
  await prisma.config.upsert({ where: { id: 1 }, update: { stockAlertDays: days }, create: { id: 1, stockAlertDays: days } });
  await audit(session.userId, "SET_GLOBAL_STOCK_ALERT_DAYS", "config", "1", { days });
  revalidateInventario();
}

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!username || !password) return "Escribe tu usuario y tu contraseña.";
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return "Usuario o contraseña incorrectos.";
  }
  await createSession({ userId: user.id, name: user.name, role: user.role });
  redirect("/");
}

export type ChangeResult = { error?: string; ok?: boolean };

export async function changePassword(_prev: ChangeResult, formData: FormData): Promise<ChangeResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  const repeat = String(formData.get("repeat") || "");
  if (!current || !next) return { error: "Rellena todos los campos." };
  if (next.length < 6) return { error: "La nueva contraseña debe tener al menos 6 caracteres." };
  if (next !== repeat) return { error: "Las dos contraseñas nuevas no coinciden." };
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    return { error: "Tu contraseña actual no es correcta." };
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  return { ok: true };
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

// --- Marcado (sobre DoseOccurrence, identidad estable) ---

// Marca una toma como hecha, guardando la fecha+hora real ("AAAA-MM-DD HH:MM", ancla Madrid).
// adjustPlan (solo maintenance): true = la próxima rueda desde ESTA toma; false = mantiene la cadencia planeada.
export async function markIntake(occId: string, when: string, adjustPlan = true): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const takenTime = normalizeWhen(when);
  const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
  if (!occ) return;
  await prisma.doseOccurrence.update({
    where: { id: occId },
    data: { status: "TAKEN", takenTime, postponeUntil: null, takenById: session.userId, recordedAt: new Date() },
  });
  if (occ.status !== "TAKEN") await adjustStock(occ.itemId, -1);
  await audit(session.userId, "MARK_TAKEN", "occurrence", occId, { takenTime, adjustPlan });
  // Maintenance: agenda la próxima rodante.
  const base = adjustPlan ? dayOf(takenTime, occ.dueDate) : occ.dueDate;
  await rollNextMaintenance(occ, base);
  revalidatePath("/");
}

// Marca varias tomas de golpe (un "pack"), con la misma fecha+hora real.
export async function markMany(occIds: string[], when: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const takenTime = normalizeWhen(when);
  for (const occId of occIds) {
    const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
    if (!occ) continue;
    await prisma.doseOccurrence.update({
      where: { id: occId },
      data: { status: "TAKEN", takenTime, postponeUntil: null, takenById: session.userId, recordedAt: new Date() },
    });
    if (occ.status !== "TAKEN") await adjustStock(occ.itemId, -1);
    await audit(session.userId, "MARK_TAKEN", "occurrence", occId, { takenTime });
    await rollNextMaintenance(occ, dayOf(takenTime, occ.dueDate));
  }
  revalidatePath("/");
}

// Marca una toma como SALTADA, con motivo opcional.
export async function skipIntake(occId: string, reason?: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const note = reason && reason.trim() ? reason.trim() : null;
  const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
  if (!occ) return;
  await prisma.doseOccurrence.update({
    where: { id: occId },
    data: { status: "SKIPPED", takenTime: null, postponeUntil: null, note, takenById: session.userId, recordedAt: new Date() },
  });
  if (occ.status === "TAKEN") await adjustStock(occ.itemId, +1);
  await audit(session.userId, "SKIP", "occurrence", occId, { note });
  // Maintenance: la próxima rueda desde la fecha planeada (no se dio, pero se mantiene la cadencia).
  await rollNextMaintenance(occ, occ.dueDate);
  revalidatePath("/");
}

// Pospone una toma. `until` = "AAAA-MM-DD HH:MM" (o fecha suelta para postergar a otro día).
// adjustPlan (maintenance): true = mueve el ancla del plan a esa fecha; false = solo aplaza este recordatorio.
export async function postponeIntake(occId: string, until: string, adjustPlan = false): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const untilTime = normalizeWhen(until);
  const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
  if (!occ) return;
  const newDay = dayOf(untilTime, occ.dueDate);
  await prisma.doseOccurrence.update({
    where: { id: occId },
    data: {
      status: "POSTPONED", postponeUntil: untilTime, takenTime: null,
      // Al ajustar el plan movemos también la fecha de la toma (el ancla rodante); si no, solo el recordatorio.
      dueDate: adjustPlan ? newDay : occ.dueDate,
      overridden: adjustPlan ? true : occ.overridden,
      takenById: session.userId, recordedAt: new Date(),
    },
  });
  if (occ.status === "TAKEN") await adjustStock(occ.itemId, +1);
  await audit(session.userId, "POSTPONE", "occurrence", occId, { untilTime, adjustPlan });
  revalidatePath("/");
}

// Quita una marca: vuelve a PENDING (o MISSED si su día ya pasó).
export async function unmarkIntake(occId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
  if (!occ) return;
  const item = await prisma.item.findUnique({ where: { id: occ.itemId } });
  const maint = item && isMaintenance(item);
  // Maintenance: al desmarcar, quitar la "próxima" que se había generado (mantener 1 abierta).
  const reopenStatus = maint ? "PENDING" : (occ.dueDate < madridDay() ? "MISSED" : "PENDING");
  await prisma.doseOccurrence.update({
    where: { id: occId },
    data: { status: reopenStatus, takenTime: null, postponeUntil: null, note: null, takenById: null, recordedAt: null },
  });
  if (maint) {
    await prisma.doseOccurrence.deleteMany({ where: { itemId: occ.itemId, id: { not: occId }, status: { in: ["PENDING", "POSTPONED"] }, dueDate: { gte: occ.dueDate } } });
  }
  if (occ.status === "TAKEN") await adjustStock(occ.itemId, +1);
  await audit(session.userId, "UNMARK", "occurrence", occId, null);
  revalidatePath("/");
}

// Marca oportunista desde el detalle de maintenance foods: "lo está comiendo ahora".
// Marca la toma abierta como hecha ahora y recalcula la próxima rodante desde hoy.
export async function markMaintenanceNow(itemId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const occ = await prisma.doseOccurrence.findFirst({ where: { itemId, status: { in: ["PENDING", "POSTPONED"] } }, orderBy: { dueDate: "asc" } });
  if (!occ) return;
  const now = `${madridDay()} ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())}`;
  await markIntake(occ.id, now, true); // adjustPlan=true: la próxima rueda desde hoy
}

// Marca como tomadas (a la hora del plan) todas las tomas atrasadas de un item en los últimos 7 días.
export async function markMissing(itemId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const today = madridDay();
  const missing = await prisma.doseOccurrence.findMany({
    where: { itemId, status: "MISSED", dueDate: { gte: addDays(today, -7), lte: today } },
  });
  for (const occ of missing) {
    const takenTime = occ.plannedTime ? `${occ.dueDate} ${occ.plannedTime}` : null;
    await prisma.doseOccurrence.update({
      where: { id: occ.id },
      data: { status: "TAKEN", takenTime, takenById: session.userId, recordedAt: new Date() },
    });
    await adjustStock(itemId, -1);
    await audit(session.userId, "MARK_TAKEN", "occurrence", occ.id, { via: "markMissing" });
  }
  revalidatePath("/");
}

// Borra una marca (toma por error). Hace lo correcto según el tipo:
// - maintenance: elimina esa toma y la "próxima" que hubiera generado, y recalcula la próxima real.
// - medicina/treatment: la desmarca (vuelve a PENDING/MISSED su turno).
export async function deleteMark(occId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const occ = await prisma.doseOccurrence.findUnique({ where: { id: occId } });
  if (!occ) return;
  const item = await prisma.item.findUnique({ where: { id: occ.itemId } });
  const wasTaken = occ.status === "TAKEN";
  if (item && isMaintenance(item)) {
    await prisma.doseOccurrence.delete({ where: { id: occId } });
    await prisma.doseOccurrence.deleteMany({ where: { itemId: occ.itemId, status: { in: ["PENDING", "POSTPONED"] } } });
    if (wasTaken) await adjustStock(occ.itemId, +1);
    await ensureMaintenanceRolling(prisma, madridDay());
  } else {
    const status = occ.dueDate < madridDay() ? "MISSED" : "PENDING";
    await prisma.doseOccurrence.update({ where: { id: occId }, data: { status, takenTime: null, postponeUntil: null, note: null, takenById: null, recordedAt: null } });
    if (wasTaken) await adjustStock(occ.itemId, +1);
  }
  await audit(session.userId, "DELETE_MARK", "occurrence", occId, { day: occ.dueDate });
  revalidatePath("/");
}

// Asegura la generación del día (lazy). Se puede llamar desde el server component.
export async function ensureToday(): Promise<void> {
  await ensureGenerated(prisma, madridDay());
}
