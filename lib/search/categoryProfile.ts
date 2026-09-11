import type { SearchTerm } from "@/types/search";
import { matchKey, normalizeText } from "./normalize";

/**
 * Category knowledge for the search engine.
 *
 * Deliberately small: a handful of configurable term layers per category
 * (no ontology). Unknown categories fall back to a generic commercial profile,
 * so the engine stays reusable across industries.
 */

export type CategoryProfile = {
  id: string;
  /** Layer 2 — synonyms / near-equivalent names of the category. */
  synonyms: string[];
  /** Latin/English naming variants (many local businesses brand themselves in Latin). */
  latinTerms: string[];
  /** Layer 3 — business-type phrases (فروشگاه X, مزون, ...). */
  businessTerms: string[];
  /** Layer 4 — product / subcategory terms. */
  productTerms: string[];
  /** Layer 5 — commercial vocabulary specific to the industry. */
  commercialTerms: string[];
  /** Careful negative terms (only sent when the provider supports them). */
  negatives: string[];
};

/** Shared Iranian commercial vocabulary (discovery signals, never proof). */
const COMMERCIAL_FA = [
  "فروش",
  "خرید",
  "سفارش",
  "قیمت",
  "ارسال",
  "موجودی",
  "فروش آنلاین",
  "فروش اینترنتی",
  "ثبت سفارش",
  "پشتیبانی",
  "مشاوره",
  "رزرو",
  "دایرکت",
  "واتساپ",
  "تلگرام",
  "ارسال به سراسر ایران",
];

const BUSINESS_FA = ["فروشگاه", "فروشگاه اینترنتی", "بوتیک", "برند", "سایت فروش"];

const GENERIC: CategoryProfile = {
  id: "generic",
  synonyms: [],
  latinTerms: [],
    businessTerms: BUSINESS_FA,
  productTerms: [],
  commercialTerms: COMMERCIAL_FA,
  negatives: ["مقاله", "خبر", "آموزش", "ایده", "عکس"],
};

const PROFILES: CategoryProfile[] = [
  {
    id: "cosmetics",
    synonyms: ["لوازم آرایش", "محصولات آرایشی", "آرایشی بهداشتی", "محصولات زیبایی"],
    latinTerms: ["cosmetics", "makeup"],
    businessTerms: ["فروشگاه آرایشی", "فروشگاه لوازم آرایشی", "فروشگاه اینترنتی آرایشی"],
    productTerms: ["رژ لب", "ریمل", "کرم", "ضدآفتاب", "پنکیک", "عطر", "مراقبت پوست", "مراقبت مو"],
    commercialTerms: ["فروش", "خرید", "قیمت", "سفارش", "ارسال", "موجودی"],
    negatives: ["مقاله", "خبر", "آموزش", "ایده", "عکس"],
  },
  {
    id: "clothing",
    synonyms: ["پوشاک", "لباس", "مزون"],
    latinTerms: ["boutique", "fashion"],
    businessTerms: ["فروشگاه لباس", "بوتیک", "پوشاک فروشی"],
    productTerms: ["مانتو", "شلوار", "پیراهن", "تی‌شرت", "سایز بزرگ", "کت و شلوار"],
    commercialTerms: ["سایز", "رنگ", "ارسال", "سفارش", "قیمت", "تعویض"],
    negatives: ["مقاله", "خبر", "آموزش", "ایده", "عکس"],
  },
  {
    id: "jewelry",
    synonyms: ["جواهرات", "طلافروشی", "زیورآلات"],
    latinTerms: ["jewelry", "gold"],
    businessTerms: ["طلا فروشی", "گالری طلا", "فروشگاه طلا"],
    productTerms: ["انگشتر", "النگو", "گردنبند", "سرویس طلا", "دستبند"],
    commercialTerms: ["قیمت روز", "اجرت", "خرید", "فروش", "سفارش"],
    negatives: ["مقاله", "خبر", "آموزش", "ایده"],
  },
  {
    id: "electronics",
    synonyms: ["گوشی", "لوازم جانبی موبایل", "کالای دیجیتال"],
    latinTerms: ["mobile shop", "electronics"],
    businessTerms: ["فروشگاه موبایل", "فروشگاه کالای دیجیتال"],
    productTerms: ["شارژر", "هندزفری", "قاب گوشی", "لپ‌تاپ", "ساعت هوشمند", "پاوربانک"],
    commercialTerms: ["قیمت", "گارانتی", "خرید", "فروش اقساطی", "ارسال"],
    negatives: ["مقاله", "خبر", "بررسی", "آموزش"],
  },
  {
    id: "home",
    synonyms: ["لوازم خانگی", "جهیزیه", "دکوراسیون"],
    latinTerms: ["furniture", "home appliance"],
    businessTerms: ["فروشگاه لوازم خانگی", "فروشگاه مبلمان"],
    productTerms: ["مبل", "سرویس خواب", "فرش", "یخچال", "ظروف"],
    commercialTerms: ["قیمت", "ارسال", "نصب", "سفارش", "اقساط"],
    negatives: ["مقاله", "خبر", "آموزش", "ایده"],
  },
  {
    id: "restaurant",
    synonyms: ["فست فود", "سفره‌خانه", "غذای آماده"],
    latinTerms: ["restaurant", "cafe"],
    businessTerms: ["رستوران", "سفره خانه", "آشپزخانه"],
    productTerms: ["کباب", "پیتزا", "غذای ایرانی", "صبحانه", "برگر"],
    commercialTerms: ["رزرو", "منو", "سفارش", "ارسال", "دلیوری", "بیرون‌بر"],
    negatives: ["مقاله", "خبر", "دستور پخت", "آموزش"],
  },
  {
    id: "services",
    synonyms: ["مرکز زیبایی", "خدمات زیبایی", "سالن زیبایی"],
    latinTerms: ["clinic", "beauty center"],
    businessTerms: ["کلینیک", "سالن زیبایی", "مرکز تخصصی"],
    productTerms: [],
    commercialTerms: ["نوبت", "رزرو", "مشاوره", "تماس", "تعرفه"],
    negatives: ["مقاله", "خبر", "آموزش"],
  },
  {
    id: "education",
    synonyms: ["دوره آموزشی", "کلاس", "آموزشگاه"],
    latinTerms: ["course", "academy"],
    businessTerms: ["آموزشگاه", "مرکز آموزشی", "موسسه آموزشی"],
    productTerms: [],
    commercialTerms: ["ثبت‌نام", "شهریه", "ظرفیت", "دوره", "مشاوره"],
    negatives: ["خبر", "مقاله"],
  },
  {
    id: "automotive",
    synonyms: ["قطعات خودرو", "تعمیرگاه"],
    latinTerms: ["auto parts", "car service"],
    businessTerms: ["فروشگاه لوازم خودرو", "تعمیرگاه تخصصی"],
    productTerms: ["لنت ترمز", "روغن موتور", "باتری", "تایر", "فیلتر"],
    commercialTerms: ["قیمت", "نصب", "سفارش", "ارسال", "خرید"],
    negatives: ["مقاله", "خبر", "آموزش"],
  },
];

const MATCHERS: { id: string; pattern: RegExp }[] = [
  { id: "cosmetics", pattern: /آرایش|arayesh|makeup|cosmetic|beauty|زیبایی/ },
  { id: "clothing", pattern: /پوشاک|لباس|مزون|clothing|fashion|apparel/ },
  { id: "jewelry", pattern: /جواهر|طلا|زر|jewelry|gold/ },
  { id: "electronics", pattern: /موبایل|گوشی|الکترونیک|دیجیتال|لپ تاپ|mobile|electronic|phone/ },
  { id: "home", pattern: /مبل|لوازم خانگی|جهیزیه|دکوراسیون|furniture|home appliance/ },
  { id: "restaurant", pattern: /رستوران|غذا|فست فود|سفره خانه|آشپزی|restaurant|food|cafe|کافه/ },
  { id: "services", pattern: /کلینیک|پزشک|سالن زیبایی|خدمات|clinic|medical|salon/ },
  { id: "education", pattern: /آموزشگاه|آموزش|دوره|کلاس|education|course/ },
  { id: "automotive", pattern: /خودرو|قطعه|تعمیرگاه|automotive|car part/ },
];

export function getCategoryProfile(category: string): CategoryProfile {
  const key = matchKey(normalizeText(category));
  if (!key) return GENERIC;
  const hit = MATCHERS.find((matcher) => matcher.pattern.test(key));
  if (!hit) return GENERIC;
  return PROFILES.find((profile) => profile.id === hit.id) ?? GENERIC;
}

const RELATION_CONFIDENCE: Record<SearchTerm["relation"], number> = {
  exact: 1,
  synonym: 0.85,
  commercial: 0.75,
  subcategory: 0.7,
  local: 0.6,
  product: 0.6,
  service: 0.6,
};

function term(value: string, relation: SearchTerm["relation"]): SearchTerm {
  return { term: normalizeText(value), relation, confidence: RELATION_CONFIDENCE[relation] };
}

/**
 * Builds the layered term set for a category.
 * Layer 1 exact → 2 synonyms → 3 business → 4 product → 5 commercial.
 */
export function categoryTerms(category: string): SearchTerm[] {
  const profile = getCategoryProfile(category);
  const exact = normalizeText(category);
  const out: SearchTerm[] = [term(exact, "exact")];

  for (const synonym of profile.synonyms) {
    if (matchKey(synonym) !== matchKey(exact)) out.push(term(synonym, "synonym"));
  }
  out.push(...profile.businessTerms.slice(0, 3).map((value) => term(value, "commercial")));
  out.push(...profile.productTerms.slice(0, 4).map((value) => term(value, "product")));
  out.push(...profile.commercialTerms.slice(0, 4).map((value) => term(value, "commercial")));

  const seen = new Set<string>();
  return out.filter((item) => {
    const key = matchKey(item.term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Latin/English naming variants for a category (never invented per request). */
export function latinTerms(category: string, max = 2): string[] {
  return getCategoryProfile(category).latinTerms.slice(0, max);
}

/** Core terms used for exact/synonym query families (layer 1 + 2). */
export function coreTerms(category: string, max = 3): SearchTerm[] {
  return categoryTerms(category)
    .filter((item) => item.relation === "exact" || item.relation === "synonym")
    .slice(0, max);
}

export function productTerms(category: string, max = 4): SearchTerm[] {
  return categoryTerms(category)
    .filter((item) => item.relation === "product")
    .slice(0, max);
}

/** Industry-specific commercial vocabulary first, then the shared Iranian set. */
export function commercialTerms(category: string, max = 6): string[] {
  const specific = getCategoryProfile(category).commercialTerms;
  const merged = [...specific, ...COMMERCIAL_FA.filter((value) => !specific.includes(value))];
  const seen = new Set<string>();
  return merged.filter((value) => {
    const key = matchKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

export function negativeTerms(category: string, max = 3): string[] {
  return getCategoryProfile(category).negatives.slice(0, max);
}

export { GENERIC as GENERIC_CATEGORY_PROFILE };
