// Generación idempotente de occurrences. Nunca sobrescribe una fila existente
// (el pasado y lo ya marcado quedan congelados). Sirve para el backfill y para el runtime.
import { addDays } from "./madrid";
import { ItemLike, isDueOn, isPeriodItem, isMaintenance, nextMaintDue, resolveDose, periodKeyFor, periodDueDate } from "./recurrence";

type SlotRow = { id: string; label: string; time: string | null; active: boolean };
type ItemWithSlots = ItemLike & { active: boolean; category: string; slots: SlotRow[] };

// Genera las occurrences NO-maintenance (medicinas, treatment) en [fromDay..toDay].
// Los maintenance foods se agendan aparte (rodante), en ensureMaintenanceRolling.
export async function generateOccurrences(
  prisma: any,
  fromDay: string,
  toDay: string,
  today: string,
): Promise<{ created: number }> {
  const items: ItemWithSlots[] = await prisma.item.findMany({
    where: { active: true },
    include: { slots: { where: { active: true } } },
  });

  const existing = new Set<string>();
  const rows: { itemId: string; slotId: string; periodKey: string }[] = await prisma.doseOccurrence.findMany({
    select: { itemId: true, slotId: true, periodKey: true },
  });
  for (const r of rows) existing.add(`${r.itemId}|${r.slotId}|${r.periodKey}`);

  const toCreate: any[] = [];
  const seenPeriod = new Set<string>();

  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    for (const item of items) {
      if (item.slots.length === 0) continue;
      if (isMaintenance(item)) continue; // rodante, aparte
      if (isPeriodItem(item)) {
        const pk = periodKeyFor(item, d);
        const slot = item.slots.find((s) => s.time == null) ?? item.slots[0];
        const key = `${item.id}|${slot.id}|${pk}`;
        if (seenPeriod.has(key) || existing.has(key)) continue;
        seenPeriod.add(key);
        const dueDate = periodDueDate(item, d);
        toCreate.push({ itemId: item.id, slotId: slot.id, periodKey: pk, dueDate, plannedTime: null, plannedDose: item.dose, status: dueDate < today ? "MISSED" : "PENDING" });
      } else {
        if (!isDueOn(item, d)) continue;
        for (const slot of item.slots) {
          const key = `${item.id}|${slot.id}|${d}`;
          if (existing.has(key)) continue;
          toCreate.push({ itemId: item.id, slotId: slot.id, periodKey: d, dueDate: d, plannedTime: slot.time, plannedDose: resolveDose(item, d), status: d < today ? "MISSED" : "PENDING" });
        }
      }
    }
  }

  if (toCreate.length > 0) await prisma.doseOccurrence.createMany({ data: toCreate });
  return { created: toCreate.length };
}

// Última fecha en que un maintenance food se resolvió (TAKEN/SKIPPED).
async function lastResolvedDate(prisma: any, itemId: string): Promise<string | null> {
  const occ = await prisma.doseOccurrence.findMany({ where: { itemId, status: { in: ["TAKEN", "SKIPPED"] } }, select: { dueDate: true, takenTime: true } });
  let best: string | null = null;
  for (const o of occ) {
    const d = /^\d{4}-\d{2}-\d{2}/.test(o.takenTime || "") ? o.takenTime.slice(0, 10) : o.dueDate;
    if (!best || d > best) best = d;
  }
  return best;
}

// Crea la PRÓXIMA toma rodante de un maintenance food (dueDate concreta). Idempotente por (item, slot, periodKey=dueDate).
export async function createMaintenanceNext(prisma: any, item: { id: string; dose: string }, dueDate: string) {
  const slot = await prisma.itemSlot.findFirst({ where: { itemId: item.id, active: true }, orderBy: { sortOrder: "asc" } });
  if (!slot) return;
  await prisma.doseOccurrence.upsert({
    where: { itemId_slotId_periodKey: { itemId: item.id, slotId: slot.id, periodKey: dueDate } },
    update: {},
    create: { itemId: item.id, slotId: slot.id, periodKey: dueDate, dueDate, plannedTime: null, plannedDose: item.dose, status: "PENDING" },
  });
}

// Asegura que cada maintenance food tenga UNA "próxima toma" abierta (rodante desde la última).
export async function ensureMaintenanceRolling(prisma: any, today: string) {
  const items = await prisma.item.findMany({ where: { active: true } });
  for (const it of items) {
    if (!isMaintenance(it)) continue;
    const open = await prisma.doseOccurrence.count({ where: { itemId: it.id, status: { in: ["PENDING", "POSTPONED"] } } });
    if (open > 0) continue; // ya hay una próxima abierta
    const last = await lastResolvedDate(prisma, it.id);
    const nextDue = last ? nextMaintDue(it, last) : today; // nunca dada aún → toca ya
    await createMaintenanceNext(prisma, it, nextDue);
  }
}

// Asegura generación de hoy..+horizonte. Maintenance: rodante. Resto: grilla + MISSED de lo vencido.
export async function ensureGenerated(prisma: any, today: string, horizonDays = 7) {
  await generateOccurrences(prisma, today, addDays(today, horizonDays), today);
  await ensureMaintenanceRolling(prisma, today);
  // Solo NO-maintenance: lo pendiente vencido pasa a MISSED. Maintenance queda PENDING (atrasado pero abierto).
  const maintItems = (await prisma.item.findMany({ where: { active: true }, select: { id: true, category: true } })).filter(isMaintenance).map((i: any) => i.id);
  await prisma.doseOccurrence.updateMany({
    where: { status: "PENDING", dueDate: { lt: today }, itemId: { notIn: maintItems } },
    data: { status: "MISSED" },
  });
}

// Al editar el plan de un item: borra sus occurrences FUTURAS pendientes (no override) y regenera.
export async function regenerateFuture(prisma: any, itemId: string, today: string, horizonDays = 7) {
  await prisma.doseOccurrence.deleteMany({
    where: { itemId, status: "PENDING", overridden: false, dueDate: { gt: today } },
  });
  await generateOccurrences(prisma, today, addDays(today, horizonDays), today);
  await ensureMaintenanceRolling(prisma, today);
}
