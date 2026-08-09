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
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Item" ("active", "anchorDay", "capped", "category", "dose", "frequency", "id", "intervalDays", "name", "rule", "sortOrder", "times") SELECT "active", "anchorDay", "capped", "category", "dose", "frequency", "id", "intervalDays", "name", "rule", "sortOrder", "times" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
