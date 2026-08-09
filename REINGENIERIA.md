# Reingeniería del modelo de datos de Rutina

> Objetivo: que **el pasado sea un hecho guardado e inmutable** y que **una marca nunca
> pueda quedar huérfana**, aunque se edite el plan. Coincide con el modelo mental correcto:
> el plan **genera tomas concretas a cumplir** y esas se marcan.

Estado: **PROPUESTA — a revisar antes de implementar.** No tocar código hasta aprobación.

Decisiones ya acordadas con Amancaya:
1. **Incluir** `AuditLog` append-only (trazabilidad médica: quién tocó qué y cuándo).
2. **Backfillear MISSED**: las tomas pasadas que tocaban y no se marcaron quedan como huecos reales.
3. Semanales/quincenales: **una toma por período con ventana** (se marca cualquier día del período).
4. Alcance: **todo de una** (medicinas y alimentos juntos).

---

## 1. Diagnóstico (por qué falla hoy)

- El pasado **no se guarda: se recalcula** con el plan actual (`dueSlots(item, día)`).
- Las marcas se enganchan por la **hora** (`slot = "15:00"`), que es dato **mutable** del plan.
- Consecuencia: editar el plan **reescribe la historia** y **desengancha** marcas → huérfanas.

Las dos causas raíz: **(a) identidad basada en dato mutable** y **(b) historia reconstruida, no congelada.**

---

## 2. Principios del nuevo modelo

1. **Materializar**: cada toma a cumplir es una fila real (`DoseOccurrence`), no un cálculo.
2. **Congelar (snapshot)**: cada fila guarda la **hora** y la **dosis** tal como estaban ese día.
   Editar el plan afecta **solo el futuro pendiente**; jamás el pasado ni lo ya marcado.
3. **Identidad estable**: la marca vive en la occurrence (id propio) y referencia un **slot con id
   estable**, no la hora. Cambiar el horario nunca desengancha nada.

---

## 3. Esquema propuesto (Prisma)

```prisma
// El QUÉ: medicina o alimento.
model Item {
  id        String  @id @default(cuid())
  name      String
  category  String  // MED | MAINTENANCE | THREE_WEEK | WEEKLY | BIWEEKLY | TREATMENT
  dose      String  // etiqueta base (para dosis fija)
  ruleNote  String?
  active    Boolean @default(true)
  sortOrder Int     @default(0)
  stock        Int?
  stockAlertAt Int?

  // El CUÁNDO (recurrencia unificada; reemplaza los 5 campos sueltos de hoy)
  recurrence    String  // DAILY | EVERY_N_DAYS | WEEKDAYS | SPECIFIC_DATES | WEEKLY | BIWEEKLY
  intervalDays  Int?    // EVERY_N_DAYS
  anchorDay     String? // EVERY_N_DAYS / BIWEEKLY (fecha ancla)
  weekdays      String? // WEEKDAYS: JSON [1,3,5]
  specificDates String? // SPECIFIC_DATES: JSON ["2026-08-07", ...]
  cycleStartDay String? // escalera de dosis (sube cada 7 días)
  doseLevels    String  @default("[]") // escalera: JSON

  slots       ItemSlot[]
  occurrences DoseOccurrence[]
}

// Los MOMENTOS de un item, con IDENTIDAD ESTABLE.
model ItemSlot {
  id        String  @id @default(cuid())
  itemId    String
  item      Item    @relation(fields: [itemId], references: [id], onDelete: Cascade)
  label     String  // "mañana" | "mediodía" | "tarde" | "noche" | "único"
  time      String? // "07:30" hora de Madrid; null = sin hora fija (alimentos/semanales)
  sortOrder Int     @default(0)
  active    Boolean @default(true)
  occurrences DoseOccurrence[]
  @@unique([itemId, label])
}

// La TOMA CONCRETA a cumplir (lo que hoy no existe). Es la unidad de verdad.
model DoseOccurrence {
  id     String   @id @default(cuid())
  itemId String
  item   Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  slotId String
  slot   ItemSlot @relation(fields: [slotId], references: [id], onDelete: Cascade)

  periodKey   String  // diario: "2026-08-08"; semanal: "2026-W32"; quincenal: "2026-BW16"
  dueDate     String  // fecha esperada (día concreto; semanal: día representativo del período)
  plannedTime String? // hora Madrid CONGELADA (copia de slot.time al generar)
  plannedDose String  // dosis CONGELADA (escalera ya resuelta para dueDate)

  status     String   @default("PENDING") // PENDING | TAKEN | SKIPPED | POSTPONED | MISSED
  takenTime  String?  // "AAAA-MM-DD HH:MM" hora real (ancla Madrid)
  takenById  String?
  postponeUntil String? // POSTPONED
  recordedAt DateTime?
  note       String?
  overridden Boolean  @default(false) // hora/dosis editada a mano (fase 2): NO se recalcula al regenerar

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([itemId, slotId, periodKey]) // idempotencia: nunca se duplica
}

// Bitácora append-only (nunca se borra). Trazabilidad médica.
model AuditLog {
  id       String   @id @default(cuid())
  at       DateTime @default(now())
  actorId  String?  // usuario que hizo la acción
  action   String   // MARK_TAKEN | SKIP | POSTPONE | UNMARK | EDIT_ITEM | EDIT_SLOT_TIME | GENERATE | MIGRATE
  entity   String   // occurrence | item | slot
  entityId String
  detail   String?  // JSON con antes/después
}
```

> `Intake`, `Config`, `User`, `PushSub`, `Notified` siguen. `Intake` se conserva **read-only**
> durante la transición (rollback) y se retira más adelante.

---

## 4. Ciclo de vida

### Generación (idempotente)
Un proceso crea occurrences desde **hoy** hasta un **horizonte** (**+7 días**):
- Corre **al abrir la app** (asegura el día actual, "lazy") **y** en el **cron de 15 min** (respaldo).
- Para cada item activo y cada fecha del rango, si la recurrencia dice que toca, hace `upsert`
  por `(item, slot, periodKey)`. **Solo crea si falta**; si crea, congela `plannedTime` y `plannedDose`.
- Nunca sobrescribe una occurrence existente → el pasado queda congelado.
- Semanales/quincenales: **una** occurrence por período (no por día), `plannedTime = null`.

### Marcar
Actualiza esa fila (`status`, `takenTime`, `takenById`, `recordedAt`) y escribe `AuditLog`.
La marca ya está atada a una fila con id propio → **imposible perderla**.

### Editar el plan
```
onItemEdit / onSlotTimeChange:
  borrar DoseOccurrence donde item=X y status=PENDING y dueDate > hoy y overridden=false
  regenerar(hoy, horizonte)                                             // con los valores nuevos
  AuditLog(EDIT_ITEM / EDIT_SLOT_TIME, antes/después)
```
Las occurrences con `overridden=true` (editadas a mano / adaptación de huso) **no** se borran ni
se recalculan.
Pasado y marcadas: **intactas**. El cambio se propaga solo hacia adelante.

### MISSED
Una occurrence PENDING cuya `dueDate` ya pasó = hueco. El cron (o la generación lazy)
la pasa a `MISSED` para que el estado sea autoritativo. Si se marca tarde → vuelve a TAKEN.

### Zona horaria (sin cambios)
`plannedTime` y `takenTime` en ancla **Madrid**; la pantalla convierte a la tz del que mira
con los helpers actuales. Los períodos semanales se calculan en ancla Madrid (consistencia).

---

## 5. Qué arregla

| Falla de hoy | Con el modelo nuevo |
|---|---|
| Cambiar hora desengancha marcas | Enganche por `slotId` estable → imposible |
| El pasado se reescribe con el plan de hoy | Filas congeladas, inmutables |
| La escalera de dosis puede derivar | `plannedDose` congelada por día |
| "Qué tocaba" es un cálculo | Es un hecho guardado |
| Huérfanas invisibles | Cada marca vive en una fila con id propio |
| Semanal/quincenal con heurística frágil | Una toma por período con ventana clara |
| Sin trazabilidad de cambios | `AuditLog` append-only |

---

## 6. Plan de migración (paso a paso, sin riesgo)

App médica en uso → todo con red.

1. **Backup** de la base (copia del archivo SQLite en prod y en dev).
2. **Rama** de trabajo; nada en `main` hasta verificar.
3. Migración Prisma: crear tablas nuevas. **Mantener `Intake`** intacta.
4. **Backfill** (script verificable):
   1. Crear `ItemSlot` desde los `times[]` actuales (etiquetas mañana/mediodía/tarde/noche por orden;
      alimentos/semanales → un slot "único" con `time = null`). Guardar mapa `(item, horaVieja) → slotId`.
      **Incluir las horas históricas** (p.ej. MagneCit noche `21:00` y actual `20:00` → mismo slot "noche";
      tarde `15:00`, `13:45` → slot "mediodía"; Fero `u`, `15:45` → slot "único").
   2. Por cada `Intake` → crear `DoseOccurrence` (slot vía mapa, `plannedDose` resuelta para su día,
      `status`/`takenTime`/`takenById`/`recordedAt` copiados). `AuditLog(MIGRATE)`.
   3. **Backfill MISSED**: por cada item y cada día pasado del período trackeado donde la recurrencia
      decía que tocaba y **no** hay Intake → occurrence `status = MISSED`. (Snapshot único; luego congelado.)
   4. **Verificar totales**: p.ej. MagneCit → 40 mañana + 40 mediodía + 39 noche; cuadrar contra lo conocido.
      Reportar cualquier Intake que **no** mapee a un slot (revisar a mano antes de finalizar).
5. **Rewire de la app**: `page.tsx`, `actions.ts`, `TodayList.tsx`, cron de notificaciones y de stock
   pasan a **leer/escribir occurrences** (en vez de `dueSlots` + join por hora).
6. **Verificación en paralelo**: para un set de días conocidos, comprobar que la pantalla nueva
   muestra lo mismo que la vieja **antes** de cambiar el default.
7. Deploy. Dejar `Intake` read-only un tiempo (rollback). Retirarla después.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El generador no corre → falta el día de hoy | Generación lazy al abrir + cron de respaldo; es rápida e idempotente |
| Mal mapeo de horas viejas → slot | Mapa explícito + reporte de "no mapeadas" antes de finalizar |
| Más superficie = más bugs | Rama + backup + verificación en paralelo |
| Bordes de período semanal con viajes/tz | Períodos calculados en ancla Madrid (igual que el plan) |
| Migración sobre datos reales | Se prueba primero en copia de dev con los datos de prod |

---

## 8. Esfuerzo

Es la pieza más grande que tocamos: schema nuevo + generador + migración con backfill + reescribir
cómo la pantalla arma el día + audit. Acotado y de una sola vez ("todo de una"), con verificación
cuidadosa. A cambio: a prueba de balas y por fin igual al modelo mental correcto.

---

## 9. Decisiones cerradas

- **Horizonte de generación: +7 días.** Aunque no se muestren todos, quedan pre-generados y
  **recalculables** ante cambios de plan o excepciones puntuales. Base para el **modo viaje**
  y para armar **planes de adaptación de huso horario** (§10).
- **Excepción por día** (editar `plannedDose`/`plannedTime` de una occurrence sin cambiar el plan):
  va en **fase 2**, pero es el **próximo paso inmediato** tras esta base (§10).
- Retiro final de la tabla `Intake`: tras N semanas estables. **Acordado.**

---

## 10. Fase 2 — próximo paso inmediato (no bloquea la base, pero se necesita)

Sobre el modelo materializado, ya casi gratis:

- **Excepción por día**: editar la hora/dosis de una occurrence puntual sin tocar el plan
  (marca `overridden = true`; la regeneración por cambio de plan la respeta y no la pisa).
- **Modo viaje / adaptación de huso**: como el futuro (+7 días) ya está materializado y las
  occurrences llevan `plannedTime` propio, se puede **desplazar gradualmente** la hora de cada
  día para adaptar el huso (p.ej. +2 h/día hasta cuadrar con destino) editando las occurrences
  futuras, sin ensuciar el plan base anclado a Madrid.

Nota para implementación: reservar en `DoseOccurrence` la semántica de "override" (una occurrence
editada a mano no se borra ni se recalcula en la regeneración de futuras pendientes).
