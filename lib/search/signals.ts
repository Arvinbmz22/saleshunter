import type { Candidate, DiscoverySourceType } from "@/types/search";
import { matchKey } from "./normalize";

/**
 * Cheap discovery signals.
 *
 * These are DISCOVERY signals only: they order and pre-filter candidates so
 * expensive verification / AI analysis runs on the most promising ones.
 * They never decide that a business is real — verification does that.
 */

export type CheapSignals = {
  positive: string[];
  negative: string[];
  categoryMatch: boolean;
  cityMatch: boolean | null;
  commercial: boolean;
  product: boolean;
  ordering: boolean;
  contactable: boolean;
  noisy: boolean;
  personal: boolean;
  foreign: boolean;
  /** 0-100 rough promise score used only for ordering. */
  score: number;
};

const COMMERCIAL_RE =
  /فروشگاه|فروش|خرید|سفارش|قیمت|ارسال|موجودی|کاتالوگ|shop|store|order|price|buy|delivery|تومان|ریال/;
const PRODUCT_RE = /رنگ|سایز|مدل|کاتالوگ|محصول|جنس|گارانتی|product|catalog|size|color/;
const ORDERING_RE =
  /سفارش|ثبت سفارش|دایرکت|واتساپ|تلگرام|رزرو|نوبت|checkout|order now|پشتیبانی/;
const CONTACT_RE = /تلفن|تماس|آدرس|email|ایمیل|واتساپ|تلگرام|دایرکت|phone|contact|@/;
const NOISE_RE =
  /مقاله|خبرگزاری|خبر|news|newspaper|ویکی|wikipedia|یوتیوب|youtube\.com\/watch|آپارات|aparat\.com\/v\/|میم|meme|فن پیج|fan ?page|طرفدار|سلبریتی|celebrity|بازیگر|خواننده/;
const PERSONAL_RE =
  /پیج شخصی|پیج شخصی من|personal (blog|account|page|diary)|diary|خاطرات|زندگی من|daily life|عکس شخصی/;
const FOREIGN_RE =
  /dubai|دبی|uae|امارات|istanbul|استانبول|turkey|ترکیه|ankara|london|los angeles|toronto|vancouver|germany|berlin|paris|malaysia|kuala lumpur/;
const IRAN_HINT_RE = /ایران|iran|تهران|مشهد|اصفهان|شیراز|تبریز|کرج|تومان|ریال|۰۲۱|051|۰۵۱|۰۳۱|\.ir/;

export type SignalContext = {
  category?: string | null;
  city?: string | null;
};

export function cheapSignals(candidate: Candidate, context: SignalContext = {}): CheapSignals {
  const text = candidate.textBlob ?? "";
  const key = matchKey(text);
  const positive: string[] = [];
  const negative: string[] = [];

  const categoryMatch = context.category
    ? key.includes(matchKey(context.category)) ||
      matchKey(context.category)
        .split(/\s+/)
        .filter((token) => token.length > 2)
        .every((token) => key.includes(token))
    : false;
  const cityMatch = context.city ? key.includes(matchKey(context.city)) : null;

  const commercial = COMMERCIAL_RE.test(text);
  const product = PRODUCT_RE.test(text);
  const ordering = ORDERING_RE.test(text);
  const contactable =
    CONTACT_RE.test(text) ||
    Boolean(candidate.website) ||
    Boolean(candidate.telegram) ||
    Boolean(candidate.whatsapp);
  const noisy = NOISE_RE.test(text);
  const personal = PERSONAL_RE.test(text);
  const foreign = FOREIGN_RE.test(text);

  if (categoryMatch) positive.push("category_match");
  if (cityMatch) positive.push("city_match");
  if (commercial) positive.push("commercial_language");
  if (product) positive.push("product_language");
  if (ordering) positive.push("ordering_language");
  if (contactable) positive.push("public_contact");
  if (candidate.website) positive.push("website");
  if (candidate.username) positive.push("instagram_profile");
  if ((candidate.discoverySources?.length ?? 0) > 1) positive.push("multi_source");
  if ((candidate.discoveryQueries?.length ?? 0) > 1) positive.push("multi_query");

  if (noisy) negative.push("news_or_content");
  if (personal) negative.push("personal_account");
  if (foreign) negative.push("foreign_location_marker");
  if (!categoryMatch && context.category) negative.push("no_category_match");

  let score = 0;
  if (categoryMatch) score += 20;
  if (cityMatch) score += 15;
  if (commercial) score += 25;
  if (product) score += 8;
  if (ordering) score += 12;
  if (contactable) score += 10;
  if (candidate.website) score += 10;
  if (candidate.username) score += 5;
  if ((candidate.discoverySources?.length ?? 0) > 1) score += 8;
  if (noisy) score -= 35;
  if (personal) score -= 40;
  if (foreign) score -= 15;

  return {
    positive,
    negative,
    categoryMatch,
    cityMatch,
    commercial,
    product,
    ordering,
    contactable,
    noisy,
    personal,
    foreign,
    score: Math.max(0, Math.min(100, Math.round(score))),
  };
}

export type EarlyRejectReason = "NO_IDENTITY" | "NOISE" | "PERSONAL" | "FOREIGN" | null;

/**
 * Very cheap filter applied BEFORE verification / AI analysis.
 * Only drops candidates that are obviously unusable; everything else is kept
 * for the verification stage so cheap signals never make the final call.
 */
export function earlyReject(
  candidate: Candidate,
  context: SignalContext = {},
): { reject: boolean; reason: EarlyRejectReason } {
  const signals = cheapSignals(candidate, context);
  const text = candidate.textBlob ?? "";

  const hasIdentity = Boolean(
    candidate.username || candidate.website || /\S{3,}/.test(text.trim()),
  );
  if (!hasIdentity) return { reject: true, reason: "NO_IDENTITY" };

  const meaningfulBusinessHint = signals.commercial || signals.product || signals.ordering;

  if (signals.personal && !meaningfulBusinessHint) {
    return { reject: true, reason: "PERSONAL" };
  }
  if (signals.noisy && !meaningfulBusinessHint) {
    return { reject: true, reason: "NOISE" };
  }
  if (signals.foreign && !IRAN_HINT_RE.test(text)) {
    return { reject: true, reason: "FOREIGN" };
  }
  return { reject: false, reason: null };
}

/** Ordering score for the candidate pool (cheap, recomputed each merge). */
export function candidatePromiseScore(candidate: Candidate, context: SignalContext = {}): number {
  const signals = cheapSignals(candidate, context);
  const sourceBonus = Math.min(10, (candidate.discoverySources?.length ?? 0) * 4);
  const queryBonus = Math.min(6, (candidate.discoveryQueries?.length ?? 0) * 2);
  const evidenceBonus = Math.min(10, (candidate.sourceUrls?.length ?? 0) * 3);
  return Math.max(
    0,
    Math.min(100, Math.round(signals.score + sourceBonus + queryBonus + evidenceBonus)),
  );
}

export function sourceDiversity(sources: DiscoverySourceType[]): number {
  return new Set(sources).size;
}
