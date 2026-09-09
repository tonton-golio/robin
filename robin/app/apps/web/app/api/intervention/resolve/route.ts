import { NextRequest, NextResponse } from "next/server";
import { locateVault } from "@/lib/vault";
import { resolveIntervention, type InterventionResolution } from "@/lib/interventions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOLUTIONS = new Set<InterventionResolution>([
  "proposed",
  "existing",
  "confirmed",
  "dismissed",
  "fulfilled",
  "missed",
  "cancelled",
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { path?: unknown; resolution?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const filePath = typeof body.path === "string" ? body.path : "";
  const resolution =
    typeof body.resolution === "string" ? (body.resolution as InterventionResolution) : null;
  if (!filePath || !resolution || !RESOLUTIONS.has(resolution)) {
    return NextResponse.json({ error: "invalid_resolution_request" }, { status: 400 });
  }

  try {
    const result = await resolveIntervention(locateVault(), filePath, resolution);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message.includes("vault_conflict") ||
      message.includes("not_open") ||
      message.includes("target_changed") ||
      message.includes("not_unique") ||
      message.includes("changed_retry") ||
      message.includes("path_collision")
        ? 409
        : message.includes("not_an_intervention") ||
            message.includes("invalid_") ||
            message.includes("unsafe_")
          ? 400
          : message.includes("ENOENT")
            ? 404
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
