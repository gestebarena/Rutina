-- AlterTable
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "currentWeek" INTEGER NOT NULL DEFAULT 1,
    "trackingStart" TEXT,
    "planTimezone" TEXT NOT NULL DEFAULT 'Europe/Madrid'
);
INSERT INTO "new_Config" ("currentWeek", "id", "trackingStart") SELECT "currentWeek", "id", "trackingStart" FROM "Config";
DROP TABLE "Config";
ALTER TABLE "new_Config" RENAME TO "Config";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
