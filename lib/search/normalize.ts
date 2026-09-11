import type { SearchRequest } from "@/types/lead";

/**
 * Normalization layer for the search engine.
 *
 * Two levels of normalization are needed:
 *  - `normalizeText`  : safe cleanup applied to text we send to providers
 *    (Persian/Arabic letter variants, zero-width chars, quotes, whitespace).
 *  - `matchKey`       : aggressive cleanup used only for comparison keys
 *    (also folds Alef-variants, digits and punctuation).
 */

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;
const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u0652\u0670]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Arabic → Persian letter variants that are safe to fold in a query. */
const LETTER_FIXES: [RegExp, string][] = [
  [/ي/g, "ی"], // Arabic yeh
  [/ى/g, "ی"], // alef maqsura
  [/ك/g, "ک"], // Arabic kaf
  [/ۀ/g, "های"],
  [/ة/g, "ه"], // teh marbuta
  [/[أإٱ]/g, "ا"], // alef variants (آ is kept: folding it breaks category matching)
];
const SAFE_LETTER_FIXES = LETTER_FIXES.slice(0, 4);

const QUOTE_FIXES: [RegExp, string][] = [
  [/["“”«»]/g, '"'],
  [/['’‘]/g, "'"],
];

const ARABIC_DIGITS = /[٠-٩]/g;

function toPersianDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x06f0));
}

/** Safe normalization: keeps the string meaningful as a search query. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let value = input.replace(CONTROL, " ");
  value = value.replace(ZERO_WIDTH, "");
  value = value.replace(TATWEEL, "");
  for (const [pattern, replacement] of SAFE_LETTER_FIXES) value = value.replace(pattern, replacement);
  value = toPersianDigits(value);
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

/** Aggressive normalization for comparison keys only. */
export function matchKey(input: string | null | undefined): string {
  if (!input) return "";
  let value = normalizeText(input).toLowerCase();
  value = value.replace(DIACRITICS, "");
  for (const [pattern, replacement] of LETTER_FIXES) value = value.replace(pattern, replacement);
  value = value.replace(/[^\p{L}\p{N}\s]/gu, " ");
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

/** Collapses repeated words without changing word order. */
export function dedupeWords(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of input.split(/\s+/)) {
    const key = matchKey(word);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out.join(" ");
}

/**
 * Normalizes a whole search request so downstream stages share one spelling.
 * City / country keep their human-readable form for display and evidence.
 */
export function normalizeRequest(request: SearchRequest): SearchRequest {
  const category = dedupeWords(normalizeText(request.category));
  const country = dedupeWords(normalizeText(request.country));
  const city = request.city ? dedupeWords(normalizeText(request.city)) : "";
  return {
    category,
    country,
    city: city || undefined,
    limit: request.limit,
  };
}

export function isIranCountry(country: string | null | undefined): boolean {
  return /ایران|iran/i.test(normalizeText(country));
}

const CITY_LATIN: Record<string, string> = {
  تهران: "Tehran",
  مشهد: "Mashhad",
  اصفهان: "Isfahan",
  شیراز: "Shiraz",
  تبریز: "Tabriz",
  کرج: "Karaj",
  قم: "Qom",
  اهواز: "Ahvaz",
  رشت: "Rasht",
  کرمان: "Kerman",
  یزد: "Yazd",
  ارومیه: "Urmia",
  همدان: "Hamadan",
  کرمانشاه: "Kermanshah",
  زاهدان: "Zahedan",
  اردبیل: "Ardabil",
  بندرعباس: "Bandar Abbas",
  قزوین: "Qazvin",
  زنجان: "Zanjan",
  سنندج: "Sanandaj",
  گرگان: "Gorgan",
  ساری: "Sari",
  کیش: "Kish",
};

/** Latin transliteration for well-known Iranian cities, when known. */
export function latinCityName(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = normalizeText(city);
  if (CITY_LATIN[key]) return CITY_LATIN[key];
  const entry = Object.entries(CITY_LATIN).find(
    ([fa]) => key.includes(fa) || fa.includes(key),
  );
  return entry ? entry[1] : null;
}

/** Area code for well-known Iranian cities (search hint, never proof). */
const CITY_AREA_CODE: Record<string, string> = {
  تهران: "021",
  مشهد: "051",
  اصفهان: "031",
  شیراز: "071",
  تبریز: "041",
  کرج: "026",
  قم: "025",
  اهواز: "061",
  رشت: "013",
  کرمان: "034",
  یزد: "035",
  همدان: "081",
  زنجان: "024",
  قزوین: "028",
  ساری: "011",
  گرگان: "017",
  ارومیه: "044",
  کرمانشاه: "083",
  زاهدان: "054",
  اردبیل: "045",
  سنندج: "087",
  بندرعباس: "076",
};

export function cityAreaCode(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = normalizeText(city);
  if (CITY_AREA_CODE[key]) return CITY_AREA_CODE[key];
  const entry = Object.entries(CITY_AREA_CODE).find(([fa]) => key.includes(fa));
  return entry ? entry[1] : null;
}

// ---------------------------------------------------------------------------
// URL canonicalization
// ---------------------------------------------------------------------------

const TRACKING_PARAMS =
  /^(utm_[a-z_]*|fbclid|gclid|gclsrc|dclid|msclkid|igshid|ref|ref_src|ref_url|source|share_id|si|spm|trk|mc_cid|mc_eid|ysclid|_hsenc|_hsmi)$/i;

const SOCIAL_HOSTS = new Set([
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "pinterest.com",
  "tiktok.com",
  "aparat.com",
  "telegram.me",
  "t.me",
  "wa.me",
  "threads.net",
  "rubika.ir",
  "soroush-app.ir",
]);

/**
 * Instagram path segments that are NOT profiles.
 * (Reading a public profile URL is allowed; we simply must not mistake
 * post/reel/explore URLs for business identities.)
 */
const IG_NON_PROFILE = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "highlights",
  "explore",
  "accounts",
  "share",
  "legal",
  "about",
  "directory",
  "popular",
  "api",
  "developer",
  "guides",
  "challenge",
  "tags",
  "locations",
  "instagram",
]);

export type CanonicalUrl = {
  url: string;
  key: string;
  host: string;
  isInstagramProfile: boolean;
  instagramUsername: string | null;
};

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * Canonicalizes a URL for identity + dedupe purposes:
 * lowercases scheme/host, drops `www.`, fragments and tracking parameters,
 * and normalizes Instagram profile URLs to `https://www.instagram.com/<user>`.
 */
export function canonicalizeUrl(raw: string | null | undefined): CanonicalUrl | null {
  const parsed = parseUrl(raw ?? "");
  if (!parsed) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return null;

  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();

  const segments = parsed.pathname.split("/").filter(Boolean);
  let isInstagramProfile = false;
  let instagramUsername: string | null = null;

  if (host === "instagram.com") {
    const first = (segments[0] ?? "").toLowerCase();
    if (first && !IG_NON_PROFILE.has(first) && /^[a-z0-9._]{2,30}$/.test(first)) {
      isInstagramProfile = true;
      instagramUsername = first;
    }
  }

  let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");

  const url = `https://${host}${pathname}${parsed.search ? `?${parsed.searchParams.toString()}` : ""}`;
  return {
    url,
    key: url.toLowerCase(),
    host,
    isInstagramProfile,
    instagramUsername,
  };
}

/** Lowercased canonical key used for result dedupe. */
export function urlKey(raw: string | null | undefined): string | null {
  return canonicalizeUrl(raw)?.key ?? null;
}

export function isSocialHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const clean = host.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.has(clean);
}

export function hostnameOf(url: string | null | undefined): string | null {
  return canonicalizeUrl(url)?.host ?? null;
}

// ---------------------------------------------------------------------------
// Query normalization / similarity
// ---------------------------------------------------------------------------

/** Normalized query text sent to providers. */
export function normalizeQueryText(query: string): string {
  let value = normalizeText(query);
  for (const [pattern, replacement] of QUOTE_FIXES) value = value.replace(pattern, replacement);
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

/** Comparison key so `"فروشگاه آرایشی تهران"` and `فروشگاه آرایشی تهران` collide. */
export function queryKey(query: string): string {
  return matchKey(normalizeQueryText(query)).replace(/\s+/g, " ");
}

const OPERATOR_TOKENS = /^(site|inurl|intitle|intext|filetype|allinurl|allintitle):?/i;

export function queryTokens(query: string): string[] {
  return matchKey(normalizeQueryText(query))
    .split(/\s+/)
    .map((token) => token.replace(OPERATOR_TOKENS, "").replace(/^[-+]/, ""))
    .filter((token) => token.length > 1);
}

/** Jaccard similarity over query token sets (0..1). */
export function querySimilarity(a: string, b: string): number {
  const setA = new Set(queryTokens(a));
  const setB = new Set(queryTokens(b));
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

/** True when two queries would ask the search engine essentially the same thing. */
export function isNearDuplicate(a: string, b: string, threshold = 0.8): boolean {
  return querySimilarity(a, b) >= threshold;
}
