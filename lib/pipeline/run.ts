import type { Lead, PipelineStage, ProgressEvent, SearchRequest, SearchStats } from "@/types/lead";
import { STAGE_LABELS } from "@/lib/pipeline/labels";
import { createAIProvider } from "@/lib/ai/provider";
import { isDuplicate } from "@/lib/leads/duplicate";
import { addLead, loadLeads } from "@/lib/leads/storage";
import { extractCandidates } from "@/lib/search/discovery";
import { executeQueries } from "@/lib/search/execute";
import { createSearchProvider } from "@/lib/search/provider";
import { adaptiveQueries, detectFailurePatterns, generateSearchQueries } from "@/lib/search/queries";
import { rankLeads } from "@/lib/scoring/ranking";
import { evidenceQuality, scoreLead } from "@/lib/scoring/score";
import {
  analyzeActivity,
  contactability,
  customerMessagePotential,
  shopBotFit,
} from "@/lib/verification/activity";
import { verifyBusiness } from "@/lib/verification/business";
import { verifyIran } from "@/lib/verification/iran";
import { verifyOnlineShop } from "@/lib/verification/shop";

export type PipelineResult = {
  leads: Lead[];
  stats: SearchStats;
};

export async function runPipeline(
  request: SearchRequest,
  onProgress: (event: ProgressEvent) => void | Promise<void>,
): Promise<PipelineResult> {
  const emit = (stage: PipelineStage, detail?: string, current?: number, total?: number) =>
    onProgress({ stage, label: STAGE_LABELS[stage], detail, current, total });

  const searchProvider = createSearchProvider();
  const aiProvider = createAIProvider();
  const historical = await loadLeads();

  emit("generate_queries");
  let queries = generateSearchQueries(request);
  await emit("generate_queries", `${queries.length} کوئری`);

  const budget = Math.min(Number(process.env.SEARCH_BUDGET ?? 80), 120);
  const targetPool = Math.min(300, Math.max(60, request.limit * 10));
  emit("public_search", searchProvider.isMock ? "حالت MOCK — داده ساختگی برچسب‌خورده" : searchProvider.name);

  const first = await executeQueries(searchProvider, queries, {
    budget,
    targetPool,
    onQuery: (query, used, total) => emit("public_search", query, used, total),
  });
  let used = first.used;
  let allResults = first.results;

  emit("extract_candidates");
  let candidates = extractCandidates(allResults);
  await emit("extract_candidates", `${candidates.length} کاندیدا`);

  const patterns = detectFailurePatterns(candidates);
  if (patterns.length && used < budget) {
    const extra = uniqueStrings(patterns.flatMap((p) => adaptiveQueries(p, request))).filter(
      (q) => !queries.includes(q),
    );
    queries = [...queries, ...extra];
    const second = await executeQueries(searchProvider, extra, {
      budget: budget - used,
      targetPool: targetPool - allResults.length,
      onQuery: (query, innerUsed, total) =>
        emit("public_search", query, used + innerUsed, used + total),
    });
    used += second.used;
    allResults = [...allResults, ...second.results];
    candidates = extractCandidates(allResults);
    await emit("extract_candidates", `${candidates.length} کاندیدا پس از جستجوی تطبیقی`);
  }

  const stats: SearchStats = {
    requested: request.limit,
    accepted: 0,
    duplicatesRemoved: 0,
    irrelevantRejected: 0,
    iranRejected: 0,
    otherRejected: 0,
    mockMode: searchProvider.isMock,
  };

  const accepted: Lead[] = [];
  const session: Lead[] = [];

  emit("iran_verification");
  for (const [index, candidate] of candidates.entries()) {
    if (accepted.length >= request.limit) break;
    await emit("iran_verification", candidate.username ?? candidate.businessName ?? "", index + 1, candidates.length);

    if (isDuplicate(candidate, [...historical, ...session])) {
      stats.duplicatesRemoved += 1;
      continue;
    }

    if (isCheapReject(candidate.textBlob)) {
      stats.irrelevantRejected += 1;
      continue;
    }

    const iran = verifyIran(candidate, { country: request.country, city: request.city });
    if (iran.reject) {
      stats.iranRejected += 1;
      continue;
    }

    emit("business_verification");
    const business = verifyBusiness(candidate);
    if (business.reject) {
      stats.irrelevantRejected += 1;
      continue;
    }

    emit("online_shop_verification");
    const shop = verifyOnlineShop(candidate);
    if (shop.reject) {
      stats.irrelevantRejected += 1;
      continue;
    }

    emit("commercial_activity");
    const activity = analyzeActivity(candidate);
    const messages = customerMessagePotential(candidate);
    const contacts = contactability(candidate);

    emit("shopbot_fit");
    const fit = shopBotFit(candidate, {
      commercial: business.commercialIntent,
      shop: shop.strength,
      messages: messages.score,
    });

    const evidenceSummary = iran.evidence.map((e) => `${e.type}:${e.signal}`).join("; ");
    const ai = await aiProvider.analyzeLead(candidate, evidenceSummary);

    const credibility = Math.min(
      100,
      (candidate.website ? 30 : 0) +
        iran.confidence * 0.4 +
        (candidate.sourceUrls?.length ?? 0) * 8 +
        (ai?.credibility ?? 0) * 0.2,
    );

    const scored = scoreLead({
      businessAuthenticity: business.confidence,
      commercialIntent: business.commercialIntent,
      onlineShopStrength: shop.strength,
      customerMessagePotential: messages.score,
      shopBotFit: Math.max(fit.score, ai?.shopBotFit ?? 0),
      catalogComplexity: messages.catalogKnownness === "unknown" ? 30 : 70,
      activityRecency: activity.status === "ACTIVE" ? 70 : activity.status === "UNKNOWN" ? 20 : 10,
      contactability: contacts,
      credibilityScale: credibility,
    });

    if (scored.tier === "REJECT") {
      stats.otherRejected += 1;
      continue;
    }

    const lead: Lead = {
      username: candidate.username ?? null,
      instagramUrl: candidate.instagramUrl ?? null,
      businessName: ai?.businessName ?? candidate.businessName ?? null,
      category: request.category,
      city: pickCity(request.city, candidate.textBlob, ai?.city),
      country: request.country,
      bio: candidate.bio ?? null,
      website: candidate.website ?? null,
      telegram: candidate.telegram ?? null,
      whatsapp: candidate.whatsapp ?? null,
      followers: null,
      businessType: ai?.businessType ?? candidate.businessType ?? null,
      evidence: iran.evidence,
      sourceUrls: candidate.sourceUrls ?? [],
      score: scored.score,
      scoreBreakdown: scored.breakdown,
      tier: scored.tier,
      reason: buildReasons(iran.status, shop.status, fit.score, contacts, ai?.reasons ?? []),
      provider: searchProvider.isMock ? "mock" : searchProvider.name,
      discoveredAt: new Date().toISOString(),
      iranVerificationStatus: iran.status,
      iranVerificationScore: iran.score,
      iranConfidence: iran.confidence,
      iranEvidence: iran.evidence,
      businessVerificationStatus: business.status,
      businessConfidence: business.confidence,
      onlineShopVerificationStatus: shop.status,
      onlineShopConfidence: shop.confidence,
      activityStatus: activity.status,
      activityConfidence: activity.confidence,
      customerMessagePotential: messages.score,
      customerMessageConfidence: messages.confidence,
      shopBotFit: fit.score,
      shopBotFitConfidence: fit.confidence,
      catalogKnownness: messages.catalogKnownness,
      credibilityScore: Math.round(credibility),
      evidenceQualityScore: 0,
      overallConfidence: Math.round((iran.confidence + business.confidence + shop.confidence) / 3),
      rejectionReason: null,
      verificationWarnings: [...iran.warnings, ...(ai?.warnings ?? [])],
    };
    lead.evidenceQualityScore = evidenceQuality(lead);

    emit("dedupe");
    session.push(lead);
    const stored = await addLead(lead);
    if (!stored.added) {
      stats.duplicatesRemoved += 1;
      continue;
    }
    accepted.push(lead);
  }

  emit("ranking");
  const ranked = rankLeads(accepted).slice(0, request.limit);
  emit("finalize", `${ranked.length} لید جدید`);
  stats.accepted = ranked.length;
  stats.otherRejected += Math.max(0, candidates.length - accepted.length - stats.duplicatesRemoved - stats.iranRejected - stats.irrelevantRejected);

  return { leads: ranked, stats };
}

function buildReasons(
  iran: string,
  shop: string,
  fit: number,
  contacts: number,
  extra: string[],
): string[] {
  const reasons = [
    iran === "VERIFIED_IRAN" ? "کسب‌وکار ایرانی با چند سیگنال عمومی مستقل تأیید شد" : "احراز ایران با شواهد قابل قبول",
    shop !== "REJECTED" ? "نشانه فروش/سفارش آنلاین در منابع عمومی دیده شد" : "",
    fit >= 50 ? "تناسب ShopBot برای پرسش‌های تکراری مشتری مناسب است" : "",
    contacts >= 25 ? "کانال تماس عمومی وجود دارد" : "",
    ...extra.filter(Boolean).slice(0, 4),
  ].filter(Boolean);
  return reasons;
}

function pickCity(requested: string | undefined, blob: string, aiCity: string | null | undefined): string | null {
  const text = blob ?? "";
  if (requested && text.includes(requested)) return requested;
  if (requested) return requested;
  if (aiCity && text.includes(aiCity)) return aiCity;
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function isCheapReject(text: string): boolean {
  if (/wikipedia\.org|youtube\.com\/watch|aparat\.com\/v\//i.test(text) && !/فروشگاه|سفارش/.test(text)) {
    return true;
  }
  if (/(?:خبرگزاری|isna\.ir|irna\.ir|tasnimnews)/i.test(text) && !/فروشگاه/.test(text)) {
    return true;
  }
  return false;
}
