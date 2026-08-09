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
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER,
    "stockAlertAt" INTEGER
);
INSERT INTO "new_Item" ("active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "rule", "sortOrder", "stock", "stockAlertAt", "times") SELECT "active", "anchorDay", "capped", "category", "currentLevel", "cycleStartDay", "dose", "doseLevels", "dosesAtLevel", "frequency", "id", "intervalDays", "levelTarget", "name", "rule", "sortOrder", "stock", "stockAlertAt", "times" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
