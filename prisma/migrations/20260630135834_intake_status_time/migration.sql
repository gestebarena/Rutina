-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Intake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TAKEN',
    "takenTime" TEXT,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "Intake_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Intake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Intake" ("day", "id", "itemId", "note", "slot", "takenAt", "userId") SELECT "day", "id", "itemId", "note", "slot", "takenAt", "userId" FROM "Intake";
DROP TABLE "Intake";
ALTER TABLE "new_Intake" RENAME TO "Intake";
CREATE UNIQUE INDEX "Intake_itemId_day_slot_key" ON "Intake"("itemId", "day", "slot");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
