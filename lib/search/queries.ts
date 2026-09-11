import type { SearchRequest } from "@/types/lead";
import { categoryVariants, cityAreaCode } from "./synonyms";

const COMMERCIAL = [
  "خرید",
  "فروش",
  "سفارش",
  "قیمت",
  "ارسال",
  "فروشگاه",
  "خرید آنلاین",
  "سفارش آنلاین",
  "دایرکت",
  "واتساپ",
  "تلگرام",
  "پشتیبانی",
  "ثبت سفارش",
  "برای قیمت دایرکت",
  "موجودی",
];

const BUSINESS_TYPES = ["فروشگاه", "فروشگاه اینترنتی", "بوتیک", "برند", "سایت فروش"];

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

export function generateSearchQueries(request: SearchRequest, extra: string[] = []): string[] {
  const category = request.category.trim();
  const country = request.country.trim();
  const city = request.city?.trim();
  const iran = /ایران|iran/i.test(country);
  const variants = categoryVariants(category);
  const queries: string[] = [];

  for (const term of variants) {
    queries.push(`${term} ${country}`);
    if (city) queries.push(`${term} ${city}`);
    if (iran) {
      queries.push(`site:instagram.com "${term}" ایران`);
      queries.push(`site:instagram.com "فروش ${term}" ایران`);
      queries.push(`site:instagram.com "فروشگاه ${term}"`);
      queries.push(`site:instagram.com "خرید ${term}" ایران`);
      if (city) {
        queries.push(`site:instagram.com "${term}" ${city}`);
        queries.push(`site:instagram.com "فروشگاه ${term}" ${city}`);
        queries.push(`فروشگاه ${term} ${city}`);
        queries.push(`فروش آنلاین ${term} ${city}`);
        queries.push(`${term} ${city} اینستاگرام`);
        queries.push(`فروشگاه اینترنتی ${term} ${city}`);
        queries.push(`"${term}" "${city}" "تومان"`);
        queries.push(`"${term}" "آدرس" "${city}"`);
      }
      queries.push(`فروشگاه اینترنتی ${term}`);
      queries.push(`خرید آنلاین ${term}`);
      queries.push(`${term} سفارش از دایرکت`);
      queries.push(`${term} برای قیمت دایرکت`);
      queries.push(`${term} ارسال به سراسر ایران`);
      queries.push(`${term} site:.ir`);
      queries.push(`"${term}" سایت رسمی ایران`);
    }
  }

  if (iran) {
    for (const word of COMMERCIAL.slice(0, 9)) {
      queries.push(`${category} ${word} ${city ?? "ایران"}`);
    }
    for (const type of BUSINESS_TYPES) {
      queries.push(`${type} ${category} ${city ?? "ایران"}`);
    }
  } else {
    queries.push(`site:instagram.com "${category}" ${country}`);
    queries.push(`${category} online shop ${country}`);
    if (city) queries.push(`${category} store ${city}`);
  }

  queries.push(...extra);
  return unique(queries).slice(0, 48);
}

export function adaptiveQueries(failurePattern: string, request: SearchRequest): string[] {
  const category = request.category;
  const city = request.city ?? "";
  const code = cityAreaCode(city);
  if (failurePattern === "influencers") {
    return unique([
      `فروشگاه ${category} ${city} سفارش واتساپ`,
      `سایت فروش ${category} ${city}`,
      `${category} فروشگاه اینترنتی ${city}`,
      `"${category}" "ثبت سفارش" "${city || "ایران"}"`,
    ]);
  }
  if (failurePattern === "foreign") {
    return unique([
      `${category} آدرس ${city || "تهران"}`,
      code ? `${category} تلفن ${code}` : "",
      `${category} سایت .ir`,
      `${category} تومان ${city}`,
      `"${category}" "ایران" "آدرس" -dubai -istanbul -turkey -uae`,
    ]);
  }
  if (failurePattern === "generic_instagram") {
    return unique([
      `${category} سایت رسمی ${city}`,
      `"${category}" "آدرس" "${city || "ایران"}"`,
      `${category} واتساپ ${city} فروشگاه`,
      `${category} site:.ir ${city}`,
    ]);
  }
  if (failurePattern === "duplicates") {
    return unique([
      `${category} بوتیک ${city}`,
      `${category} برند ایرانی ${city}`,
      `${category} فروشگاه محلی ${city}`,
      `site:instagram.com ${category} ${city} فروش آنلاین`,
    ]);
  }
  return [];
}

export function detectFailurePatterns(
  candidates: { textBlob: string; website?: string | null; username?: string | null }[],
): string[] {
  if (!candidates.length) return ["duplicates"];
  const n = candidates.length;
  const patterns: string[] = [];
  const influencer = candidates.filter((c) =>
    /influencer|اینفلوئنسر|پیج شخصی|fan page/i.test(c.textBlob),
  ).length;
  const foreign = candidates.filter((c) =>
    /dubai|istanbul|turkey|uae|دبی|استانبول|ترکیه/i.test(c.textBlob),
  ).length;
  const generic = candidates.filter((c) => c.username && !c.website).length;
  const uniqueUsers = new Set(candidates.map((c) => c.username).filter(Boolean)).size;
  if (influencer > n / 4) patterns.push("influencers");
  if (foreign > n / 5) patterns.push("foreign");
  if (generic > n / 2) patterns.push("generic_instagram");
  if (n > 8 && uniqueUsers < n / 3) patterns.push("duplicates");
  return patterns;
}
