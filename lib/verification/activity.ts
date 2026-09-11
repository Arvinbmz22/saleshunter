import type { ActivityStatus, Knownness } from "@/types/lead";
import type { Candidate } from "@/lib/search/discovery";

export function analyzeActivity(candidate: Candidate): {
  status: ActivityStatus;
  confidence: number;
} {
  const text = candidate.textBlob ?? "";
  if (/inactive|تعطیل شد|دیگر فعالیت نمی‌کند/.test(text)) {
    return { status: "INACTIVE", confidence: 70 };
  }
  if (/ارسال فوری|موجود|الآن|today|۱۴۰[3-5]|202[4-6]/.test(text)) {
    return { status: "ACTIVE", confidence: 55 };
  }
  return { status: "UNKNOWN", confidence: 0 };
}

export function customerMessagePotential(candidate: Candidate): {
  score: number;
  confidence: number;
  catalogKnownness: Knownness;
} {
  const text = candidate.textBlob ?? "";
  let score = 0;
  if (/رنگ|سایز|مدل|variant|size|color/.test(text)) score += 25;
  if (/قیمت|موجودی|ارسال|سفارش/.test(text)) score += 25;
  if (/مشاوره|پشتیبانی|رزرو/.test(text)) score += 15;
  if (/کاتالوگ|چندین محصول|مجموعه/.test(text)) score += 20;
  if ((candidate.telegram || candidate.whatsapp) && /دایرکت|سفارش/.test(text)) score += 15;
  return {
    score: Math.min(100, score),
    confidence: score ? 50 : 0,
    catalogKnownness: /کاتالوگ|محصول/.test(text) ? "estimated" : "unknown",
  };
}

export function shopBotFit(candidate: Candidate, extras: { commercial: number; shop: number; messages: number }): {
  score: number;
  confidence: number;
} {
  const text = candidate.textBlob ?? "";
  if (/پیج شخصی|news|meme|portfolio/.test(text)) {
    return { score: 10, confidence: 70 };
  }
  const score = Math.round(
    extras.commercial * 0.25 + extras.shop * 0.3 + extras.messages * 0.45,
  );
  return { score: Math.min(100, score), confidence: 55 };
}

export function contactability(candidate: Candidate): number {
  let score = 0;
  if (candidate.website) score += 30;
  if (candidate.telegram) score += 25;
  if (candidate.whatsapp) score += 25;
  if (/آدرس|email|@/.test(candidate.textBlob ?? "")) score += 20;
  return Math.min(100, score);
}
