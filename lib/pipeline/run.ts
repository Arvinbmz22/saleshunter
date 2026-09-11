import type { Lead, PipelineStage, ProgressEvent, SearchRequest, SearchStats } from "@/types/lead";
import type { Candidate, RejectedBreakdown } from "@/types/search";
import { STAGE_LABELS, stopReasonLabel } from "@/lib/pipeline/labels";
import { createAIProvider } from "@/lib/ai/provider";
import { isDuplicate } from "@/lib/leads/duplicate";
import { addLead, loadLeads } from "@/lib/leads/storage";
import { SearchEngine } from "@/lib/search/engine";
import { normalizeRequest } from "@/lib/search/normalize";
import { createSearchProvider } from "@/lib/search/provider";
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

function emptyRejected(): RejectedBreakdown {
  return {
    personal: 0,
    fanOrNews: 0,
    foreign: 0,
    irrelevant: 0,
    duplicates: 0,
    iranRejected: 0,
    other: 0,
  };
}

/**
 * Search → cheap filter → candidate pool → verification → ranking.
 *
 * The engine only discovers candidates; every quality decision lives in the
 * verification modules. Nothing is fabricated: if fewer candidates qualify
 * than requested, fewer leads are returned.
 */
export async function runPipeline(
  request: SearchRequest,
  onProgress: (event: ProgressEvent) => void | Promise<void>,
): Promise<PipelineResult> {
  const normalized = normalizeRequest(request);

  const emit = (stage: PipelineStage, detail?: string, current?: number, total?: number) =>
    onProgress({ stage, label: STAGE_LABELS[stage], detail, current, total });

  const searchProvider = createSearchProvider();
  const aiProvider = createAIProvider();
  const historical = await loadLeads();

  emit("generate_queries");
  const engine = new SearchEngine({
    request: normalized,
    provider: searchProvider,
    historical,
    onProgress: async (event) => {
      if (event.kind === "round_start") {
        await emit(
          event.round > 1 ? "expanding_search" : "public_search",
          event.detail,
          event.round,
          event.maxRounds,
        );
        return;
      }
      if (event.kind === "query") {
        await emit(
          event.round > 1 ? "expanding_search" : "public_search",
          event.query,
          event.executed,
          event.budget,
        );
        return;
      }
      await emit("extract_candidates", event.detail, event.candidates, engine.snapshot.targetCandidates);
    },
  });
  await emit(
    "generate_queries",
    `${engine.snapshot.queriesGenerated} کوئری در حداکثر ${engine.snapshot.maxRounds} دور`,
  );

  if (searchProvider.isMock) {
    await emit("public_search", "حالت MOCK — داده ساختگی برچسب‌خورده، نه جستجوی واقعی");
  }

  const stats: SearchStats = {
    requested: normalized.limit,
    accepted: 0,
    duplicatesRemoved: 0,
    irrelevantRejected: 0,
    iranRejected: 0,
    otherRejected: 0,
    mockMode: searchProvider.isMock,
  };

  const accepted: Lead[] = [];
  const session: Lead[] = [];
  const processed = new Set<string>();
  let rejected: RejectedBreakdown = emptyRejected();
  let lastStop = engine.snapshot.stoppedReason;

  while (engine.hasMoreRounds()) {
    const outcome = await engine.runNextRound();

    const pool = engine.candidates;
    let index = 0;
    for (const candidate of pool) {
      if (accepted.length >= normalized.limit) break;
      if (processed.has(candidate.identityKey)) continue;
      processed.add(candidate.identityKey);
      index += 1;

      await emit(
        "iran_verification",
        candidate.username ?? candidate.businessName ?? "",
        index,
        pool.length,
      );

      const result = await evaluateCandidate({
        candidate,
        request: normalized,
        historical,
        session,
        aiProvider,
        emit,
      });

      if (result.kind === "duplicate") {
        stats.duplicatesRemoved += 1;
        rejected.duplicates += 1;
        continue;
      }
      if (result.kind === "rejected") {
        applyRejection(stats, result.reason);
        countRejected(rejected, result.reason, result.detail);
        continue;
      }

      const lead = result.lead;
      session.push(lead);
      const stored = await addLead(lead);
      if (!stored.added) {
        stats.duplicatesRemoved += 1;
        rejected.duplicates += 1;
        continue;
      }
      accepted.push(lead);
    }

    engine.noteQualified(accepted.length, rejected);
    rejected = emptyRejected();
    lastStop = engine.snapshot.stoppedReason;

    if (accepted.length >= normalized.limit) {
      engine.stop("ENOUGH_QUALIFIED_LEADS");
      lastStop = "ENOUGH_QUALIFIED_LEADS";
      break;
    }
    if (engine.isStopped()) break;
    if (!outcome.queriesExecuted) break;
  }

  if (!engine.isStopped()) engine.stop(lastStop ?? "NO_MORE_USEFUL_RESULTS");

  emit("dedupe");
  emit("ranking");
  const ranked = rankLeads(accepted).slice(0, normalized.limit);
  stats.accepted = ranked.length;
  stats.search = engine.diagnostics;
  stats.partialSearch = engine.diagnostics.partialSearch;
  const diagnostics = engine.diagnostics;
  stats.otherRejected += Math.max(
    0,
    diagnostics.candidates - ranked.length - stats.duplicatesRemoved - stats.iranRejected - stats.irrelevantRejected,
  );
  await emit("finalize", `${ranked.length} لید جدید — ${stopReasonLabel(diagnostics.stopReason)}`);

  return { leads: ranked, stats };
}

type EvaluateResult =
  | { kind: "accepted"; lead: Lead }
  | { kind: "duplicate" }
  | { kind: "rejected"; reason: keyof RejectedBreakdown | "other"; detail?: string };

async function evaluateCandidate(args: {
  candidate: Candidate;
  request: SearchRequest;
  historical: Lead[];
  session: Lead[];
  aiProvider: ReturnType<typeof createAIProvider>;
  emit: (stage: PipelineStage, detail?: string, current?: number, total?: number) => Promise<void> | void;
}): Promise<EvaluateResult> {
  const { candidate, request, historical, session, aiProvider, emit } = args;

  if (isDuplicate(candidate, [...historical, ...session])) {
    return { kind: "duplicate" };
  }

  const iran = verifyIran(candidate, { country: request.country, city: request.city });
  if (iran.reject) {
    return {
      kind: "rejected",
      reason: iran.status === "NOT_IRAN" ? "foreign" : "iranRejected",
      detail: iran.status,
    };
  }

  await emit("business_verification");
  const business = verifyBusiness(candidate);
  if (business.reject) {
    return {
      kind: "rejected",
      reason: business.reason === "personal" ? "personal" : business.reason === "fan/meme" || business.reason === "news" || business.reason === "celebrity" || business.reason === "influencer" ? "fanOrNews" : "irrelevant",
      detail: business.reason ?? undefined,
    };
  }

  await emit("online_shop_verification");
  const shop = verifyOnlineShop(candidate);
  if (shop.reject) {
    return { kind: "rejected", reason: "irrelevant", detail: shop.reason ?? undefined };
  }

  await emit("commercial_activity");
  const activity = analyzeActivity(candidate);
  const messages = customerMessagePotential(candidate);
  const contacts = contactability(candidate);

  await emit("shopbot_fit");
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
    return { kind: "rejected", reason: "other", detail: "score below threshold" };
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
    provider: candidate.results?.[0]?.provider ?? "unknown",
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

  return { kind: "accepted", lead };
}

function applyRejection(stats: SearchStats, reason: keyof RejectedBreakdown | "other"): void {
  if (reason === "duplicates") stats.duplicatesRemoved += 1;
  else if (reason === "iranRejected") stats.iranRejected += 1;
  else if (reason === "other") stats.otherRejected += 1;
  else stats.irrelevantRejected += 1;
}

function countRejected(target: RejectedBreakdown, reason: keyof RejectedBreakdown | "other", detail?: string): void {
  if (reason === "other") {
    target.other += 1;
    return;
  }
  target[reason] += 1;
  if (reason === "foreign" && detail === "UNCERTAIN") target.iranRejected += 1;
}

function buildReasons(
  iran: string,
  shop: string,
  fit: number,
  contacts: number,
  extra: string[],
): string[] {
  const reasons = [
    iran === "VERIFIED_IRAN" ? "کسب‌وکار با چند سیگنال عمومی مستقل تأیید شد" : "احراز هویت با شواهد قابل قبول",
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
