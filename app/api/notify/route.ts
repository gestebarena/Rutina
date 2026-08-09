import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendToAll } from "@/lib/push";
import { ensureGenerated } from "@/lib/generate";

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
    prisma.notified.findMany({ where: { key: { startsWith: `${today}|` } } }),
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

  if (missed.length === 0) return NextResponse.json({ sent: 0, missed: 0 });

  const title = missed.length === 1 ? "Rutina: falta una toma" : `Rutina: faltan ${missed.length} tomas`;
  const body = missed.map((m) => `${m.name} (${m.time})`).join(", ");
  const sent = await sendToAll(title, body);

  await prisma.notified.createMany({ data: newKeys.map((key) => ({ key })) });

  return NextResponse.json({ sent, missed: missed.length });
}
