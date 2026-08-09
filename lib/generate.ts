// Generación idempotente de occurrences. Nunca sobrescribe una fila existente
// (el pasado y lo ya marcado quedan congelados). Sirve para el backfill y para el runtime.
import { addDays } from "./madrid";
import { ItemLike, isDueOn, isPeriodItem, resolveDose, periodKeyFor, periodDueDate } from "./recurrence";

type SlotRow = { id: string; label: string; time: string | null; active: boolean };
type ItemWithSlots = ItemLike & { active: boolean; slots: SlotRow[] };

// Crea las occurrences faltantes en [fromDay..toDay]. Estado inicial:
// dueDate < today -> MISSED; si no -> PENDING. Idempotente por (item, slot, periodKey).
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

  // Claves ya existentes, para no duplicar ni pisar.
  const existing = new Set<string>();
  const rows: { itemId: string; slotId: string; periodKey: string }[] = await prisma.doseOccurrence.findMany({
    select: { itemId: true, slotId: true, periodKey: true },
  });
  for (const r of rows) existing.add(`${r.itemId}|${r.slotId}|${r.periodKey}`);

  const toCreate: any[] = [];
  const seenPeriod = new Set<string>(); // para items de período: una por período

  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    for (const item of items) {
      if (item.slots.length === 0) continue;
      if (isPeriodItem(item)) {
        const pk = periodKeyFor(item, d);
        const slot = item.slots.find((s) => s.time == null) ?? item.slots[0];
        const key = `${item.id}|${slot.id}|${pk}`;
        if (seenPeriod.has(key) || existing.has(key)) continue;
        seenPeriod.add(key);
        const dueDate = periodDueDate(item, d);
        toCreate.push({
          itemId: item.id, slotId: slot.id, periodKey: pk, dueDate,
          plannedTime: null, plannedDose: item.dose,
          status: dueDate < today ? "MISSED" : "PENDING",
        });
      } else {
        if (!isDueOn(item, d)) continue;
        for (const slot of item.slots) {
          const key = `${item.id}|${slot.id}|${d}`;
          if (existing.has(key)) continue;
          toCreate.push({
            itemId: item.id, slotId: slot.id, periodKey: d, dueDate: d,
            plannedTime: slot.time, plannedDose: resolveDose(item, d),
            status: d < today ? "MISSED" : "PENDING",
          });
        }
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.doseOccurrence.createMany({ data: toCreate });
  }
  return { created: toCreate.length };
}

// Asegura que existan las occurrences de hoy..+horizonte y pasa a MISSED las PENDING ya vencidas.
// Idempotente y barato: se llama al abrir la app (lazy) y desde el cron.
export async function ensureGenerated(prisma: any, today: string, horizonDays = 7) {
  await generateOccurrences(prisma, today, addDays(today, horizonDays), today);
  // Lo que quedó pendiente en el pasado (p.ej. cambió el día) pasa a atrasado.
  await prisma.doseOccurrence.updateMany({
    where: { status: "PENDING", dueDate: { lt: today } },
    data: { status: "MISSED" },
  });
}

// Al editar el plan de un item: borra sus occurrences FUTURAS pendientes (no override) y regenera.
export async function regenerateFuture(prisma: any, itemId: string, today: string, horizonDays = 7) {
  await prisma.doseOccurrence.deleteMany({
    where: { itemId, status: "PENDING", overridden: false, dueDate: { gt: today } },
  });
  await generateOccurrences(prisma, today, addDays(today, horizonDays), today);
}
