// Transición al modelo RODANTE de maintenance foods.
// Borra las occurrences PENDING/MISSED de maintenance (venían de la grilla vieja) —conserva TAKEN/SKIPPED (historial)—
// y crea UNA "próxima toma" rodante por alimento (cada N días desde la última). Idempotente.
import "dotenv/config";
import { prisma } from "../lib/db";
import { madridDay } from "../lib/madrid";
import { isMaintenance } from "../lib/recurrence";
import { ensureMaintenanceRolling } from "../lib/generate";

(async () => {
  const today = madridDay();
  const items = await prisma.item.findMany({ where: { active: true } });
  const maint = items.filter(isMaintenance);
  const ids = maint.map((i) => i.id);
  const del = await prisma.doseOccurrence.deleteMany({ where: { itemId: { in: ids }, status: { in: ["PENDING", "MISSED"] } } });
  console.log(`Borradas ${del.count} occurrences PENDING/MISSED de maintenance (grilla vieja).`);
  await ensureMaintenanceRolling(prisma, today);
  console.log("Creadas las 'próximas tomas' rodantes.");
  // Reporte
  for (const it of maint) {
    const open = await prisma.doseOccurrence.findFirst({ where: { itemId: it.id, status: { in: ["PENDING", "POSTPONED"] } }, orderBy: { dueDate: "asc" } });
    console.log(`  ${it.name.padEnd(28)} próxima: ${open?.dueDate ?? "—"}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
