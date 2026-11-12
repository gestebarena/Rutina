// Cambia la hora fija del cacahuete a 16:45 (como lo hace saveItem): actualiza times + slot
// y regenera las tomas FUTURAS pendientes (la de hoy conserva su hora). Idempotente.
import { prisma } from "../lib/db";
import { regenerateFuture } from "../lib/generate";
import { madridDay } from "../lib/madrid";

const ID = "tf-cacahuete";
const NEW_TIME = "16:45";

async function main() {
  const before = await prisma.item.findUnique({ where: { id: ID }, include: { slots: true } });
  if (!before) { console.log("NO existe", ID); return; }
  console.log("ANTES  times:", before.times, "slots:", before.slots.map((s) => `${s.label}=${s.time}${s.active ? "" : "(off)"}`).join(", "));

  await prisma.item.update({ where: { id: ID }, data: { times: JSON.stringify([NEW_TIME]) } });
  await prisma.itemSlot.updateMany({ where: { itemId: ID, active: true }, data: { time: NEW_TIME } });

  const today = madridDay();
  await regenerateFuture(prisma, ID, today);

  const after = await prisma.item.findUnique({
    where: { id: ID },
    include: { slots: true, occurrences: { where: { dueDate: { gte: today } }, orderBy: { dueDate: "asc" }, take: 6 } },
  });
  console.log("DESPUÉS times:", after?.times, "slots:", after?.slots.map((s) => `${s.label}=${s.time}${s.active ? "" : "(off)"}`).join(", "));
  console.log("Tomas desde hoy:", after?.occurrences.map((o) => `${o.dueDate} ${o.plannedTime ?? "—"} [${o.status}]`).join(" | "));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
