import { describe, expect, it } from "vitest";
import { isDuplicate, isSameLead } from "@/lib/leads/duplicate";
import { normalizeInstagramUrl, normalizeUsername } from "@/lib/leads/normalize";
import { rankLeads } from "@/lib/scoring/ranking";
import { scoreLead, tierOf } from "@/lib/scoring/score";
import { parseAIResponse } from "@/lib/ai/provider";
import { adaptiveQueries, generateSearchQueries } from "@/lib/search/queries";
import type { Lead } from "@/types/lead";

function baseLead(over: Partial<Lead>): Lead {
  const scored = scoreLead({
    businessAuthenticity: 80,
    commercialIntent: 80,
    onlineShopStrength: 80,
    customerMessagePotential: 80,
    shopBotFit: 80,
    catalogComplexity: 70,
    activityRecency: 50,
    contactability: 50,
    credibilityScale: 50,
  });
  return {
    username: "a",
    instagramUrl: "https://www.instagram.com/a",
    businessName: "A",
    category: "x",
    city: "تهران",
    country: "ایران",
    bio: null,
    website: null,
    telegram: null,
    whatsapp: null,
    followers: 10,
    businessType: "shop",
    evidence: [],
    sourceUrls: [],
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    tier: scored.tier,
    reason: [],
    provider: "test",
    discoveredAt: new Date().toISOString(),
    iranVerificationStatus: "VERIFIED_IRAN",
    iranVerificationScore: 90,
    iranConfidence: 90,
    iranEvidence: [],
    businessVerificationStatus: "VERIFIED",
    businessConfidence: 80,
    onlineShopVerificationStatus: "VERIFIED",
    onlineShopConfidence: 80,
    activityStatus: "ACTIVE",
    activityConfidence: 50,
    customerMessagePotential: 80,
    customerMessageConfidence: 50,
    shopBotFit: 80,
    shopBotFitConfidence: 50,
    catalogKnownness: "estimated",
    credibilityScore: 50,
    evidenceQualityScore: 70,
    overallConfidence: 80,
    rejectionReason: null,
    verificationWarnings: [],
    ...over,
  };
}

describe("deduplication", () => {
  it("normalizes usernames and URLs", () => {
    expect(normalizeUsername("@BeautyShop")).toBe("beautyshop");
    expect(normalizeUsername("https://instagram.com/BeautyShop/")).toBe("beautyshop");
    expect(normalizeUsername("https://www.instagram.com/beautyshop")).toBe("beautyshop");
    expect(normalizeInstagramUrl("@BeautyShop")).toBe("https://www.instagram.com/beautyshop");
  });

  it("detects username and business-level duplicates", () => {
    expect(
      isSameLead(
        { username: "@Shop_X", instagramUrl: "https://instagram.com/shop_x/" },
        { username: "shop_x" },
      ),
    ).toBe(true);
    expect(
      isSameLead(
        { website: "https://shop-x.ir", businessName: "Shop X", city: "Tehran" },
        { website: "https://www.shop-x.ir/about", businessName: "Shop X", city: "Tehran" },
      ),
    ).toBe(true);
    expect(isDuplicate({ username: "a" }, [{ username: "A" }])).toBe(true);
  });
});

describe("scoring and ranking", () => {
  it("uses published weights and tiers", () => {
    expect(tierOf(92)).toBe("HOT");
    expect(tierOf(80)).toBe("HIGH");
    expect(tierOf(65)).toBe("MEDIUM");
    expect(tierOf(45)).toBe("LOW");
    expect(tierOf(10)).toBe("REJECT");
  });

  it("small high-fit shop beats huge poor-fit account", () => {
    const small = baseLead({
      followers: 400,
      shopBotFit: 90,
      overallConfidence: 90,
      iranVerificationStatus: "VERIFIED_IRAN",
      scoreBreakdown: {
        businessAuthenticity: 90,
        commercialIntent: 90,
        onlineShopStrength: 90,
        customerMessagePotential: 90,
        shopBotFit: 90,
        catalogComplexity: 80,
        activityRecency: 40,
        contactability: 70,
        credibilityScale: 40,
      },
    });
    const huge = baseLead({
      username: "b",
      followers: 2_000_000,
      shopBotFit: 20,
      overallConfidence: 40,
      iranVerificationStatus: "LIKELY_IRAN",
      scoreBreakdown: {
        businessAuthenticity: 30,
        commercialIntent: 20,
        onlineShopStrength: 10,
        customerMessagePotential: 10,
        shopBotFit: 20,
        catalogComplexity: 10,
        activityRecency: 80,
        contactability: 10,
        credibilityScale: 90,
      },
    });
    expect(rankLeads([huge, small])[0]?.username).toBe("a");
  });
});

describe("AI schema", () => {
  it("accepts valid JSON", () => {
    expect(
      parseAIResponse(
        JSON.stringify({
          businessName: "x",
          businessType: "shop",
          city: "تهران",
          reasons: [],
          warnings: [],
          shopBotFit: 70,
          credibility: 60,
          inventedClaims: [],
        }),
      )?.businessName,
    ).toBe("x");
  });

  it("rejects malformed, missing, unknown, hallucinated", () => {
    expect(parseAIResponse("{nope")).toBeNull();
    expect(parseAIResponse(JSON.stringify({ businessName: "x" }))).toBeNull();
    expect(
      parseAIResponse(
        JSON.stringify({
          businessName: "x",
          businessType: "shop",
          city: "تهران",
          reasons: [],
          warnings: [],
          shopBotFit: 70,
          credibility: 60,
          inventedClaims: ["made up phone"],
        }),
      ),
    ).toBeNull();
  });
});

describe("search queries", () => {
  it("generates multiple families", () => {
    const q = generateSearchQueries({ category: "لوازم آرایشی", country: "ایران", city: "تهران", limit: 20 });
    expect(q.length).toBeGreaterThan(8);
    expect(q.some((x) => x.includes("site:instagram.com"))).toBe(true);
    expect(q.some((x) => x.includes("دایرکت") || x.includes("فروشگاه اینترنتی"))).toBe(true);
    expect(q.some((x) => x.includes("cosmetics") || x.includes("تومان"))).toBe(true);
  });

  it("adapts when many results look foreign", () => {
    const extra = adaptiveQueries("foreign", {
      category: "لوازم آرایشی",
      country: "ایران",
      city: "تهران",
      limit: 10,
    });
    expect(extra.some((x) => x.includes("021") || x.includes(".ir"))).toBe(true);
  });
});
