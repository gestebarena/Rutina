import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendToAll, sendToAdmins } from "@/lib/push";
import { ensureGenerated } from "@/lib/generate";
import { unitsPerDay, daysOfSupply, effectiveThreshold, unitLabel } from "@/lib/stock";

export const dynamic = "force-dynamic";

const MARGIN_MIN = 30; // minutos tras la hora antes de avisar
const MUST_CATS = new Set(["MED", "MAINTENANCE", "THREE_WEEK", "TREATMENT"]);

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const config = await prisma.config.findUnique({ where: { id: 1 } });
  const planTz = config?.planTimezone ?? "Europe/Madrid";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: planTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const nowHHMM = new Intl.DateTimeFormat("en-GB", { timeZone: planTz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const nowMin = toMin(nowHHMM);

  await ensureGenerated(prisma, today);

  const [items, occs, notified] = await Promise.all([
    prisma.item.findMany({ where: { active: true } }),
    prisma.doseOccurrence.findMany({ where: { dueDate: today, status: { in: ["PENDING", "MISSED"] } } }),
    prisma.notified.findMany({ where: { OR: [{ key: { startsWith: `${today}|` } }, { key: { endsWith: `|${today}` } }] } }),
  ]);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const alreadyNotified = new Set(notified.map((n) => n.key));

  const missed: { name: string; time: string }[] = [];
  const newKeys: string[] = [];

  for (const o of occs) {
    const it = itemById.get(o.itemId);
    if (!it || !MUST_CATS.has(it.category)) continue;
    if (!o.plannedTime) continue; // sin hora fija no se puede "pasar de hora"
    if (nowMin < toMin(o.plannedTime) + MARGIN_MIN) continue; // aún no se pasó la hora
    const key = `${today}|${o.id}`;
    if (alreadyNotified.has(key)) continue;
    missed.push({ name: it.name, time: o.plannedTime });
    newKeys.push(key);
  }

  let sent = 0;
  if (missed.length > 0) {
    const title = missed.length === 1 ? "Rutina: falta una toma" : `Rutina: faltan ${missed.length} tomas`;
    const body = missed.map((m) => `${m.name} (${m.time})`).join(", ");
    sent = await sendToAll(title, body);
    await prisma.notified.createMany({ data: newKeys.map((key) => ({ key })) });
  }

  // --- Aviso de stock bajo (inventario de medicinas): solo a admins ---
  const medsWithStock = await prisma.item.findMany({
    where: { active: true, category: "MED", stock: { not: null } },
    include: { slots: { where: { active: true } } },
  });
  const lowStock: { name: string; days: number; stock: number; unit: string }[] = [];
  const stockKeys: string[] = [];
  for (const it of medsWithStock) {
    const upd = unitsPerDay(it, it.slots.length);
    const days = daysOfSupply(it.stock as number, upd);
    const threshold = effectiveThreshold(it, config);
    if (!Number.isFinite(days) || days > threshold) continue;
    const key = `stocklow|${it.id}|${today}`; // máx. 1 aviso por medicina y día
    if (alreadyNotified.has(key)) continue;
    lowStock.push({ name: it.name, days, stock: it.stock as number, unit: unitLabel(it.stockUnit, it.stock as number) });
    stockKeys.push(key);
  }

  let stockSent = 0;
  if (lowStock.length > 0) {
    const title = lowStock.length === 1 ? "Rutina: stock bajo" : `Rutina: ${lowStock.length} medicinas con stock bajo`;
    const body = lowStock
      .map((s) => `${s.name}: ~${s.days} ${s.days === 1 ? "día" : "días"} (quedan ${s.stock} ${s.unit})`)
      .join(", ");
    stockSent = await sendToAdmins(title, body);
    await prisma.notified.createMany({ data: stockKeys.map((key) => ({ key })) });
  }

  return NextResponse.json({ sent, missed: missed.length, stockSent, stockLow: lowStock.length });
}
