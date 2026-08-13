import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// El BUILD_ID de Next cambia en cada `next build` → sirve para detectar una versión nueva desplegada.
let cached: string | null = null;

export async function GET() {
  if (!cached) {
    try {
      cached = (await fs.readFile(path.join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
    } catch {
      cached = "dev";
    }
  }
  return NextResponse.json({ v: cached }, { headers: { "Cache-Control": "no-store" } });
}
