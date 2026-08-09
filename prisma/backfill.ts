// Backfill: migra del modelo viejo (Intake + horas) al nuevo (ItemSlot + DoseOccurrence).
// Idempotente-ish: pensado para correr UNA vez sobre una base ya migrada de esquema.
// Verifica totales y reporta lo que no mapea limpio. NO borra la tabla Intake.
import "dotenv/config";
import { prisma } from "../lib/db";
import { madridDay } from "../lib/madrid";
import { deriveRecurrence, slotLabels, mapOldSlot, periodKeyFor, periodDueDate, isPeriodItem, resolveDose, ItemLike } from "../lib/recurrence";
import { generateOccurrences } from "../lib/generate";

const TODAY = madridDay(); // ancla Madrid
const HORIZON_DAYS = 7;

function parseArr(s: string | null | undefined): any[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const cfg = await prisma.config.findFirst();
  const start = cfg?.trackingStart || "2026-06-30";
  console.log(`== Backfill == hoy=${TODAY} trackingStart=${start} horizonte=+${HORIZON_DAYS}d\n`);

  // 0) Si ya hay occurrences, abortar (evita doble backfill).
  const already = await prisma.doseOccurrence.count();
  if (already > 0) { console.log(`Ya hay ${already} occurrences. Abortando para no duplicar.`); return; }

  // 1) Items con sus intakes (todos, incluso inactivos con historial).
  const items = await prisma.item.findMany({ include: { intakes: true } });

  // Mapa item -> slots creados
  const slotsByItem = new Map<string, { id: string; label: string; time: string | null }[]>();

  for (const it of items) {
    // 1a) Derivar recurrencia nueva y guardarla en el item.
    const rec = deriveRecurrence({ category: it.category, intervalDays: it.intervalDays, doseDays: it.doseDays });
    await prisma.item.update({ where: { id: it.id }, data: rec });

    // 1b) Crear slots estables desde times[].
    const times = parseArr(it.times) as string[];
    const labels = slotLabels(times.length);
    const created: { id: string; label: string; time: string | null }[] = [];
    for (let i = 0; i < labels.length; i++) {
      const time = times.length === 0 ? null : (times[i] ?? null);
      const s = await prisma.itemSlot.create({ data: { itemId: it.id, label: labels[i], time, sortOrder: i } });
      created.push({ id: s.id, label: s.label, time: s.time });
    }
    slotsByItem.set(it.id, created);
  }

  // 2) Occurrences desde los Intakes, con resolución de conflictos.
  const chosen = new Map<string, any>(); // key item|slotId|periodKey -> data
  const dropped: string[] = [];
  const farMapped: string[] = []; // distMin grande -> revisar

  for (const it of items) {
    const slots = slotsByItem.get(it.id)!;
    const itemLike = it as unknown as ItemLike;
    for (const ik of it.intakes) {
      const m = mapOldSlot(ik.slot, slots);
      if (m.distMin > 90) farMapped.push(`${it.id} ${ik.day} slot=${ik.slot} -> ${m.label} (${m.distMin}min)`);
      const slot = slots.find((s) => s.label === m.label)!;
      const pk = periodKeyFor({ recurrence: it.recurrence }, ik.day);
      const dueDate = isPeriodItem({ recurrence: it.recurrence }) ? periodDueDate({ recurrence: it.recurrence }, ik.day) : ik.day;
      const key = `${it.id}|${slot.id}|${pk}`;

      const status = ik.status; // TAKEN | SKIPPED | POSTPONED
      const data = {
        itemId: it.id, slotId: slot.id, periodKey: pk, dueDate,
        plannedTime: slot.time, plannedDose: resolveDose(itemLike, ik.day),
        status,
        takenTime: status === "POSTPONED" ? null : ik.takenTime,
        postponeUntil: status === "POSTPONED" ? ik.takenTime : null,
        takenById: ik.userId, recordedAt: ik.recordedAt, note: ik.note,
        _origSlot: ik.slot, _dist: m.distMin,
      } as any;

      const prev = chosen.get(key);
      if (!prev) { chosen.set(key, data); continue; }
      // Conflicto: preferir TAKEN con hora real; luego menor distancia.
      const score = (x: any) => (x.status === "TAKEN" ? 1000 : 0) - x._dist;
      if (score(data) > score(prev)) { chosen.set(key, data); dropped.push(`${it.id} ${dueDate} ${prev._origSlot}`); }
      else dropped.push(`${it.id} ${dueDate} ${data._origSlot}`);
    }
  }

  const occData = [...chosen.values()].map(({ _origSlot, _dist, ...d }) => d);
  if (occData.length) await prisma.doseOccurrence.createMany({ data: occData });
  console.log(`Occurrences desde Intakes: ${occData.length} (descartados por conflicto: ${dropped.length})`);
  if (farMapped.length) { console.log(`\n⚠️  Mapeos lejanos (>90min) a revisar (${farMapped.length}):`); farMapped.forEach((x) => console.log("   " + x)); }
  if (dropped.length) { console.log(`\nℹ️  Descartados (siguen en Intake, no se pierden):`); dropped.forEach((x) => console.log("   " + x)); }

  // 3) Rellenar la grilla: MISSED (pasado) y PENDING (hoy..+7).
  const gen = await generateOccurrences(prisma, start, addDays(TODAY, HORIZON_DAYS), TODAY);
  console.log(`\nGrilla generada (MISSED pasado + PENDING futuro): +${gen.created} occurrences`);

  // 4) Auditoría (una entrada resumen).
  await prisma.auditLog.create({ data: { action: "MIGRATE", entity: "occurrence", entityId: "-", detail: JSON.stringify({ fromIntakes: occData.length, generated: gen.created, dropped: dropped.length }) } });

  // 5) Verificación de totales.
  console.log(`\n== Verificación ==`);
  const byStatus = await prisma.doseOccurrence.groupBy({ by: ["status"], _count: true });
  console.log("Occurrences por estado:", byStatus.map((s: any) => `${s.status}=${s._count}`).join("  "));

  // Comparar TAKEN/SKIPPED por item contra los Intakes.
  console.log("\nPor item (Intakes TAKEN/SKIP  vs  Occurrences TAKEN/SKIP):");
  for (const it of items) {
    const inT = it.intakes.filter((x) => x.status === "TAKEN").length;
    const inS = it.intakes.filter((x) => x.status === "SKIPPED").length;
    const occ = await prisma.doseOccurrence.findMany({ where: { itemId: it.id } });
    const oT = occ.filter((x: any) => x.status === "TAKEN").length;
    const oS = occ.filter((x: any) => x.status === "SKIPPED").length;
    const flag = inT - oT !== 0 || inS - oS !== 0 ? "  <-- dif (conflictos)" : "";
    if (it.intakes.length > 0) console.log(`  ${it.id.padEnd(16)} I:${inT}/${inS}  O:${oT}/${oS}${flag}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
