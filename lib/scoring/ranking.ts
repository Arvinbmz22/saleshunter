import type { Lead } from "@/types/lead";

const iranRank: Record<string, number> = {
  VERIFIED_IRAN: 4,
  LIKELY_IRAN: 2,
  NOT_APPLICABLE: 3,
  UNCERTAIN: 1,
  NOT_IRAN: 0,
};

export function rankLeads(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => {
    const keys: number[] = [
      (b.overallConfidence ?? 0) - (a.overallConfidence ?? 0),
      (iranRank[b.iranVerificationStatus] ?? 0) - (iranRank[a.iranVerificationStatus] ?? 0),
      (b.scoreBreakdown.businessAuthenticity ?? 0) - (a.scoreBreakdown.businessAuthenticity ?? 0),
      (b.scoreBreakdown.commercialIntent ?? 0) - (a.scoreBreakdown.commercialIntent ?? 0),
      (b.scoreBreakdown.onlineShopStrength ?? 0) - (a.scoreBreakdown.onlineShopStrength ?? 0),
      (b.shopBotFit ?? 0) - (a.shopBotFit ?? 0),
      (b.customerMessagePotential ?? 0) - (a.customerMessagePotential ?? 0),
      (b.evidenceQualityScore ?? 0) - (a.evidenceQualityScore ?? 0),
      (b.scoreBreakdown.activityRecency ?? 0) - (a.scoreBreakdown.activityRecency ?? 0),
      (b.scoreBreakdown.contactability ?? 0) - (a.scoreBreakdown.contactability ?? 0),
      (b.score ?? 0) - (a.score ?? 0),
    ];
    return keys.find((v) => v !== 0) ?? 0;
  });
}
