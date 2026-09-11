import { loadLeads } from "@/lib/leads/storage";
import { rateLimit } from "@/lib/security/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`leads:${ip}`, 30, 60_000)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  const leads = await loadLeads();
  const sorted = [...leads].sort((a, b) => (b.discoveredAt > a.discoveredAt ? 1 : -1));
  return Response.json({ leads: sorted, total: sorted.length });
}
