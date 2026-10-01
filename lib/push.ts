import webpush from "web-push";
import { prisma } from "./db";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@rutina.estebarena.com";
  if (!pub || !priv) throw new Error("Faltan las claves VAPID.");
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

// Envía un payload a una lista concreta de suscripciones. Borra las caducadas.
async function sendTo(subs: Sub[], title: string, body: string): Promise<number> {
  configure();
  const payload = JSON.stringify({ title, body });
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      ok++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      // 404/410 = suscripción caducada: la borramos.
      if (code === 404 || code === 410) {
        await prisma.pushSub.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }
  return ok;
}

// Envía un aviso a TODOS los móviles suscritos.
export async function sendToAll(title: string, body: string): Promise<number> {
  return sendTo(await prisma.pushSub.findMany(), title, body);
}

// Envía un aviso solo a los móviles de los usuarios ADMIN (mamá y papá).
export async function sendToAdmins(title: string, body: string): Promise<number> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const ids = admins.map((a) => a.id);
  if (ids.length === 0) return 0;
  const subs = await prisma.pushSub.findMany({ where: { userId: { in: ids } } });
  return sendTo(subs, title, body);
}
