import { NextResponse } from "next/server";
import { listBriefs } from "@/lib/build-system-prompt";

/**
 * GET /api/interview/briefs
 * Returns list of brief slugs + titles from logs/briefs/
 */
export async function GET(): Promise<NextResponse> {
  const briefs = await listBriefs();
  return NextResponse.json({ briefs });
}
