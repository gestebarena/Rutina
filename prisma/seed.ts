import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

// Contraseñas iniciales (se podrán cambiar más adelante).
const users = [
  { username: "amancaya", name: "Amancaya", role: "ADMIN", password: "rutina-mama" },
  { username: "gonzalo", name: "Gonzalo", role: "ADMIN", password: "rutina-papa" },
  { username: "nico", name: "Nico", role: "CHILD", password: "rutina-nico" },
];

type I = {
  id: string;
  name: string;
  dose: string;
  category: string;
  frequency: string;
  times?: string[];
  rule?: string;
  capped?: boolean;
  intervalDays?: number;
  anchorDay?: string;
  doseLevels?: string[];
  cycleStartDay?: string;
  doseDays?: string[];
  sortOrder: number;
};

const TF_RULE = "≥4 h tras mantenimiento · separar 15 min · 1 h de reposo después · completar 7 días de la última semana antes del challenge";

// Plan de Nico — actualizado con el informe FAI (Tolerance Visit 1). Horas en hora de Madrid.
const items: I[] = [
  // --- MEDICINAS (sin cambios) ---
  { id: "med-advagraf", name: "Advagraf", dose: "7 mg", category: "MED", frequency: "cada 24 h", times: ["07:30"], rule: "2 h de ayuno antes y 1 h después", sortOrder: 1 },
  { id: "med-myfortic", name: "Myfortic", dose: "180 mg (1 pastilla)", category: "MED", frequency: "cada 12 h", times: ["07:30", "20:00"], sortOrder: 2 },
  { id: "med-prednisona", name: "Prednisona (o Medrol)", dose: "5 mg (≡ Medrol 4 mg)", category: "MED", frequency: "cada 48 h", times: ["07:30"], rule: "Días alternos · Medrol 4 mg se sustituye por Prednisona 5 mg (equivalencia del médico; en España a veces no hay Medrol)", intervalDays: 2, anchorDay: "2026-08-01", sortOrder: 3 },
  { id: "med-amlodipino", name: "Amlodipino", dose: "5 mg", category: "MED", frequency: "cada 24 h", times: ["07:30"], sortOrder: 4 },
  { id: "med-cetirizina", name: "Cetirizina (Zyrtec)", dose: "10 mg", category: "MED", frequency: "cada 24 h", times: ["07:30"], sortOrder: 5 },
  { id: "med-fero", name: "Fero-Gradumet", dose: "1 pastilla", category: "MED", frequency: "cada 24 h", times: ["15:45"], rule: "Lejos de lácteos y del magnesio (2 h después del MagneCit del mediodía)", sortOrder: 6 },
  { id: "med-magnecit", name: "MagneCit", dose: "2 pastillas", category: "MED", frequency: "3 x día", times: ["07:30", "13:45", "20:00"], rule: "Lejos de lácteos y del Fero (horas orientativas; la del mediodía va entre la mañana y la noche)", sortOrder: 7 },
  { id: "med-saizen", name: "Hormona crecimiento (Saizen)", dose: "1.6 mg", category: "MED", frequency: "cada 24 h", times: ["21:30"], rule: "Antes de dormir (flexible)", sortOrder: 8 },

  // --- MAINTENANCE 3x/semana (Lun/Mié/Vie) ---
  { id: "main-pecana", name: "Pecana", dose: "6 mitades", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 1 },
  { id: "main-avellana", name: "Avellana", dose: "4 unidades", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 2 },
  { id: "main-nuez", name: "Nuez", dose: "6 mitades", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 3 },
  { id: "main-sesamo", name: "Sésamo", dose: "1/2 cdta", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 4 },
  { id: "tw-castana", name: "Castaña", dose: "1 cdta", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 5 },
  { id: "tw-macadamia", name: "Macadamia", dose: "1 unidad", category: "THREE_WEEK", frequency: "3 x semana", times: [], sortOrder: 6 },
  { id: "tf-yema", name: "Yema de huevo cruda", dose: "14 ml", category: "THREE_WEEK", frequency: "días concretos → luego sábados", times: [], rule: "14 ml · 7,8,9/8 y 11,13,15/8; luego semanal (sábados)", doseDays: ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-11", "2026-08-13", "2026-08-15", "2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"], sortOrder: 7 },

  // --- MAINTENANCE semanal ---
  { id: "tw-pistacho", name: "Pistacho", dose: "8 unidades", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 1 },
  { id: "tw-anacardo", name: "Anacardo", dose: "8 unidades", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 2 },
  { id: "tw-almendra", name: "Almendra", dose: "6 unidades", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 3 },
  { id: "tw-brasil", name: "Nuez de Brasil", dose: "1 unidad", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 4 },
  { id: "tw-soja", name: "Soja", dose: "1/4 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 5 },
  { id: "tw-coco", name: "Harina de coco", dose: "1/4 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 6 },
  { id: "wk-germen", name: "Germen de trigo tostado", dose: "1/2 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 7 },
  { id: "wk-girasol", name: "Semilla de girasol (molida)", dose: "1/4 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 8 },
  { id: "wk-lino", name: "Semilla de lino (molida)", dose: "1/4 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 9 },
  { id: "wk-lenteja", name: "Lenteja", dose: "1/2 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 10 },
  { id: "wk-garbanzo", name: "Harina de garbanzo", dose: "1 cdta", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 11 },
  { id: "wk-gamba", name: "Gamba cocida", dose: "1 oz (30 g)", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 12 },
  { id: "wk-salmon", name: "Salmón cocido", dose: "1 oz (30 g)", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 13 },
  { id: "main-bacalao", name: "Bacalao cocido", dose: "2 oz", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 14 },
  { id: "wk-atun", name: "Atún", dose: "según tolerancia", category: "WEEKLY", frequency: "semanal", times: [], sortOrder: 15 },

  // --- MAINTENANCE cada 2 semanas ---
  { id: "wk-amapola", name: "Semilla de amapola", dose: "1/4 cdta", category: "BIWEEKLY", frequency: "cada 2 semanas", times: [], sortOrder: 1 },
  { id: "wk-chia", name: "Semilla de chía", dose: "1/4 cdta", category: "BIWEEKLY", frequency: "cada 2 semanas", times: [], sortOrder: 2 },
  { id: "wk-pinon", name: "Piñones", dose: "30 unidades", category: "BIWEEKLY", frequency: "cada 2 semanas", times: [], sortOrder: 3 },
  { id: "wk-almeja", name: "Almeja cocida", dose: "1 oz (30 g)", category: "BIWEEKLY", frequency: "cada 2 semanas", times: [], sortOrder: 4 },

  // --- TREATMENT FOODS (tarde) — escalera automática por fecha ---
  { id: "tf-calabaza", name: "Semilla de calabaza (molida)", dose: "200 mg", category: "TREATMENT", frequency: "diario (tarde)", times: ["17:00"], rule: TF_RULE, doseLevels: ["1 mg", "2.5 mg", "5 mg", "10 mg", "20 mg", "30 mg", "40 mg", "60 mg", "100 mg", "200 mg", "1/8 cdta"], cycleStartDay: "2026-06-01", sortOrder: 1 },
  { id: "tf-clara", name: "Clara de huevo cruda", dose: "3.5 ml", category: "TREATMENT", frequency: "diario (tarde)", times: ["17:15"], rule: TF_RULE, doseLevels: ["3.5 ml", "4 ml", "4.5 ml", "5 ml", "5.5 ml", "6 ml", "7 ml"], cycleStartDay: "2026-08-03", sortOrder: 2 },
  { id: "tf-cacahuete", name: "Cacahuete", dose: "18 cacahuetes", category: "TREATMENT", frequency: "6 días/semana (tarde)", times: ["17:30"], rule: "6 días/semana (1 día libre) · 1 h de reposo · día de exploración 1x/sem · mantequilla JIF: 1 cdta≈3, 2 cdas≈18 (enjuagar boca y beber agua)", sortOrder: 3 },
];

async function main() {
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      // OJO: al actualizar NO tocamos la contraseña, para no borrar la que cada uno haya elegido.
      update: { name: u.name, role: u.role },
      create: { username: u.username, name: u.name, role: u.role, passwordHash },
    });
  }

  // IDs que siguen en el plan; el resto se desactiva (no se muestra).
  const keepIds = new Set(items.map((i) => i.id));

  for (const it of items) {
    const data = {
      name: it.name,
      dose: it.dose,
      category: it.category,
      frequency: it.frequency,
      times: JSON.stringify(it.times ?? []),
      rule: it.rule ?? null,
      capped: it.capped ?? false,
      intervalDays: it.intervalDays ?? null,
      anchorDay: it.anchorDay ?? null,
      doseLevels: JSON.stringify(it.doseLevels ?? []),
      cycleStartDay: it.cycleStartDay ?? null,
      doseDays: JSON.stringify(it.doseDays ?? []),
      sortOrder: it.sortOrder,
      active: true,
    };
    // La escalera es por fecha; dose se recalcula al mostrar. NO tocamos stock (lo pone el admin).
    await prisma.item.upsert({
      where: { id: it.id },
      update: data,
      create: { id: it.id, ...data },
    });
  }

  // Desactivar items que ya no están en el plan (p.ej. si algo se retira).
  await prisma.item.updateMany({ where: { id: { notIn: [...keepIds] } }, data: { active: false } });

  // Ajustes: semana actual del ciclo (no se pisa si ya existe un valor distinto).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const cfg = await prisma.config.upsert({ where: { id: 1 }, update: {}, create: { id: 1, currentWeek: 5, trackingStart: today } });
  if (!cfg.trackingStart) await prisma.config.update({ where: { id: 1 }, data: { trackingStart: today } });

  console.log(`Listo: ${users.length} usuarios y ${items.length} items.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
