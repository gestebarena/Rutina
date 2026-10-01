/*
  Warnings:

  - You are about to alter the column `stock` on the `Item` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
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
    "stock" REAL,
    "stockUnit" TEXT,
    "perDose" REAL,
    "presentations" TEXT NOT NULL DEFAULT '[]',
    "stockAlertAt" INTEGER,
    "stockAlertDays" INTEGER
);
INSERT INTO "new_Item" ("active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseDays", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "recurrence", "rule", "sortOrder", "specificDates", "stock", "stockAlertAt", "stockAlertDays", "times", "weekdays") SELECT "active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseDays", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "recurrence", "rule", "sortOrder", "specificDates", "stock", "stockAlertAt", "stockAlertDays", "times", "weekdays" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
