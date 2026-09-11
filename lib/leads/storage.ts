import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { Lead } from "@/types/lead";
import { isDuplicate } from "./duplicate";

const DATA_DIR = process.env.LEADS_DATA_DIR
  ? path.resolve(process.env.LEADS_DATA_DIR)
  : path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "leads.json");

function withDefaults(raw: Partial<Lead>): Lead {
  return {
    username: raw.username ?? null,
    instagramUrl: raw.instagramUrl ?? null,
    businessName: raw.businessName ?? null,
    category: raw.category ?? null,
    city: raw.city ?? null,
    country: raw.country ?? null,
    bio: raw.bio ?? null,
    website: raw.website ?? null,
    telegram: raw.telegram ?? null,
    whatsapp: raw.whatsapp ?? null,
    followers: raw.followers ?? null,
    businessType: raw.businessType ?? null,
    evidence: raw.evidence ?? [],
    sourceUrls: raw.sourceUrls ?? [],
    score: raw.score ?? 0,
    scoreBreakdown: raw.scoreBreakdown ?? {
      businessAuthenticity: 0,
      commercialIntent: 0,
      onlineShopStrength: 0,
      customerMessagePotential: 0,
      shopBotFit: 0,
      catalogComplexity: 0,
      activityRecency: 0,
      contactability: 0,
      credibilityScale: 0,
    },
    tier: raw.tier ?? "REJECT",
    reason: raw.reason ?? [],
    provider: raw.provider ?? "unknown",
    discoveredAt: raw.discoveredAt ?? new Date().toISOString(),
    iranVerificationStatus: raw.iranVerificationStatus ?? "UNCERTAIN",
    iranVerificationScore: raw.iranVerificationScore ?? 0,
    iranConfidence: raw.iranConfidence ?? 0,
    iranEvidence: raw.iranEvidence ?? [],
    businessVerificationStatus: raw.businessVerificationStatus ?? "UNKNOWN",
    businessConfidence: raw.businessConfidence ?? 0,
    onlineShopVerificationStatus: raw.onlineShopVerificationStatus ?? "UNKNOWN",
    onlineShopConfidence: raw.onlineShopConfidence ?? 0,
    activityStatus: raw.activityStatus ?? "UNKNOWN",
    activityConfidence: raw.activityConfidence ?? 0,
    customerMessagePotential: raw.customerMessagePotential ?? 0,
    customerMessageConfidence: raw.customerMessageConfidence ?? 0,
    shopBotFit: raw.shopBotFit ?? 0,
    shopBotFitConfidence: raw.shopBotFitConfidence ?? 0,
    catalogKnownness: raw.catalogKnownness ?? "unknown",
    credibilityScore: raw.credibilityScore ?? 0,
    evidenceQualityScore: raw.evidenceQualityScore ?? 0,
    overallConfidence: raw.overallConfidence ?? 0,
    rejectionReason: raw.rejectionReason ?? null,
    verificationWarnings: raw.verificationWarnings ?? [],
  };
}

export async function loadLeads(): Promise<Lead[]> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => withDefaults(item as Partial<Lead>));
  } catch {
    return [];
  }
}

export async function saveLeads(leads: Lead[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(leads, null, 2), "utf8");
}

export async function addLead(lead: Lead): Promise<{ added: boolean; leads: Lead[] }> {
  const leads = await loadLeads();
  if (isDuplicate(lead, leads)) {
    return { added: false, leads };
  }
  const next = [...leads, withDefaults(lead)];
  await saveLeads(next);
  return { added: true, leads: next };
}

export { DATA_FILE };
