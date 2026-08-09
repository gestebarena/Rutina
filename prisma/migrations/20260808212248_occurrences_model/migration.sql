-- CreateTable
CREATE TABLE "ItemSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "time" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ItemSlot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DoseOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "plannedTime" TEXT,
    "plannedDose" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "takenTime" TEXT,
    "takenById" TEXT,
    "postponeUntil" TEXT,
    "recordedAt" DATETIME,
    "note" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DoseOccurrence_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DoseOccurrence_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ItemSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "times" TEXT NOT NULL DEFAULT '[]',
    "rule" TEXT,
    "intervalDays" INTEGER,
    "anchorDay" TEXT,
    "doseLevels" TEXT NOT NULL DEFAULT '[]',
    "levelTarget" INTEGER NOT NULL DEFAULT 7,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "dosesAtLevel" INTEGER NOT NULL DEFAULT 0,
    "cycleStartDay" TEXT,
    "doseDays" TEXT NOT NULL DEFAULT '[]',
    "recurrence" TEXT NOT NULL DEFAULT 'DAILY',
    "weekdays" TEXT,
    "specificDates" TEXT,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER,
    "stockAlertAt" INTEGER
);
INSERT INTO "new_Item" ("active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseDays", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "rule", "sortOrder", "stock", "stockAlertAt", "times") SELECT "active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseDays", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "rule", "sortOrder", "stock", "stockAlertAt", "times" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ItemSlot_itemId_label_key" ON "ItemSlot"("itemId", "label");

-- CreateIndex
CREATE INDEX "DoseOccurrence_dueDate_idx" ON "DoseOccurrence"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "DoseOccurrence_itemId_slotId_periodKey_key" ON "DoseOccurrence"("itemId", "slotId", "periodKey");
