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

// Envía un aviso a TODOS los móviles suscritos. Borra los que ya no valen.
export async function sendToAll(title: string, body: string): Promise<number> {
  configure();
  const subs = await prisma.pushSub.findMany();
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
