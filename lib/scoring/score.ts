import type { Lead, LeadTier, ScoreBreakdown } from "@/types/lead";

export function scoreLead(input: {
  businessAuthenticity: number;
  commercialIntent: number;
  onlineShopStrength: number;
  customerMessagePotential: number;
  shopBotFit: number;
  catalogComplexity: number;
  activityRecency: number;
  contactability: number;
  credibilityScale: number;
}): { score: number; breakdown: ScoreBreakdown; tier: LeadTier } {
  const breakdown: ScoreBreakdown = {
    businessAuthenticity: clamp(input.businessAuthenticity),
    commercialIntent: clamp(input.commercialIntent),
    onlineShopStrength: clamp(input.onlineShopStrength),
    customerMessagePotential: clamp(input.customerMessagePotential),
    shopBotFit: clamp(input.shopBotFit),
    catalogComplexity: clamp(input.catalogComplexity),
    activityRecency: clamp(input.activityRecency),
    contactability: clamp(input.contactability),
    credibilityScale: clamp(input.credibilityScale),
  };
  const score = Math.round(
    breakdown.businessAuthenticity * 0.15 +
      breakdown.commercialIntent * 0.15 +
      breakdown.onlineShopStrength * 0.15 +
      breakdown.customerMessagePotential * 0.15 +
      breakdown.shopBotFit * 0.15 +
      breakdown.catalogComplexity * 0.1 +
      breakdown.activityRecency * 0.05 +
      breakdown.contactability * 0.05 +
      breakdown.credibilityScale * 0.05,
  );
  return { score, breakdown, tier: tierOf(score) };
}

export function tierOf(score: number): LeadTier {
  if (score >= 90) return "HOT";
  if (score >= 75) return "HIGH";
  if (score >= 60) return "MEDIUM";
  if (score >= 40) return "LOW";
  return "REJECT";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function evidenceQuality(lead: Pick<Lead, "iranEvidence" | "evidence" | "sourceUrls">): number {
  const n = new Set(
    [...(lead.iranEvidence ?? []), ...(lead.evidence ?? [])].map((e) => e.sourceId),
  ).size;
  return Math.min(100, n * 35 + (lead.sourceUrls?.length ? 10 : 0));
}
