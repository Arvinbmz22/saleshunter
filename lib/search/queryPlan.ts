import type { SearchRequest } from "@/types/lead";
import type {
  Candidate,
  FailurePattern,
  ProviderCapabilities,
  QueryFamily,
  SearchQuery,
  SearchTerm,
} from "@/types/search";
import { coreTerms, latinTerms, negativeTerms, productTerms } from "./categoryProfile";
import {
  cityAreaCode,
  isIranCountry,
  latinCityName,
  normalizeQueryText,
  normalizeText,
  querySimilarity,
} from "./normalize";

/**
 * Query generation engine.
 *
 * Responsibilities
 *  - build the layered term set (exact / synonym / business / product / commercial)
 *  - generate query FAMILIES instead of one giant template
 *  - score + rank + diversify queries
 *  - schedule queries into adaptive search rounds
 *  - generate adaptive / follow-up queries from observed failures
 *
 * This module is provider-agnostic: provider-specific operators are applied
 * through `ProviderCapabilities` so no provider logic leaks into planning.
 */

export type PlanOptions = {
  capabilities: ProviderCapabilities;
  maxRounds: number;
  /** Max queries scheduled per round (budget still wins at runtime). */
  queriesPerRound: number;
};

export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  siteOperator: true,
  negativeTerms: true,
  maxResultsPerQuery: 10,
};

const FAMILY_BASE_VALUE: Record<QueryFamily, number> = {
  exact_category: 0.72,
  commercial_intent: 0.85,
  business_type: 0.8,
  contact_channel: 0.7,
  product_specific: 0.6,
  website: 0.55,
  domain: 0.5,
  directory: 0.45,
  location_focus: 0.7,
  follow_up: 0.5,
  adaptive: 0.65,
};


/** Round schedule: which family contributes how many queries in which round. */
const ROUND_SCHEDULE: { round: number; family: QueryFamily; count: number }[] = [
  { round: 1, family: "exact_category", count: 4 },
  { round: 1, family: "commercial_intent", count: 4 },
  { round: 1, family: "business_type", count: 2 },
  { round: 1, family: "location_focus", count: 2 },
  { round: 2, family: "commercial_intent", count: 4 },
  { round: 2, family: "contact_channel", count: 3 },
  { round: 2, family: "business_type", count: 2 },
  { round: 3, family: "location_focus", count: 4 },
  { round: 3, family: "exact_category", count: 2 },
  { round: 3, family: "directory", count: 2 },
  { round: 4, family: "product_specific", count: 4 },
  { round: 4, family: "website", count: 3 },
  { round: 5, family: "website", count: 2 },
  { round: 5, family: "domain", count: 2 },
  { round: 5, family: "directory", count: 2 },
  { round: 7, family: "contact_channel", count: 3 },
  { round: 7, family: "product_specific", count: 2 },
  { round: 7, family: "location_focus", count: 2 },
];

export const ADAPTIVE_ROUND = 6;

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

type LocationContext = {
  iran: boolean;
  city: string | null;
  /** City-focused location strings (most specific first). */
  locations: string[];
  /** Country-level fallback used when no city is available. */
  broad: string;
  /** [city, country] mix for families that should cover both levels. */
  mixed: string[];
  primary: string;
};

export function buildLocationContext(request: SearchRequest): LocationContext {
  const iran = isIranCountry(request.country);
  const city = request.city ? normalizeText(request.city) : null;
  const country = normalizeText(request.country);
  const latin = iran ? latinCityName(city) : null;

  const cityVariants: string[] = [];
  if (city) {
    cityVariants.push(city);
    if (iran) cityVariants.push(`${city} ایران`);
    else if (country) cityVariants.push(`${city} ${country}`);
    if (latin) cityVariants.push(latin);
  }
  const broad = iran ? "ایران" : country;

  const dedupe = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = value.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const locations = dedupe(cityVariants).slice(0, 3);
  const mixed = city ? dedupe([city, broad]) : [broad];

  return {
    iran,
    city,
    locations,
    broad,
    mixed,
    primary: locations[0] ?? broad,
  };
}

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

type RawQuery = {
  query: string;
  family: QueryFamily;
  term: string;
  location: string | null;
  commercialIntent: number;
  locationSpecificity: number;
  categoryRelevance: number;
  expectedValue: number;
};

function siteScoped(caps: ProviderCapabilities, host: string, body: string): string {
  return caps.siteOperator ? `site:${host} ${body}` : `${host} ${body}`;
}

function withNegatives(caps: ProviderCapabilities, query: string, negatives: string[]): string {
  if (!caps.negativeTerms || !negatives.length) return query;
  return `${query} ${negatives.map((n) => `-${n}`).join(" ")}`;
}

function q(raw: RawQuery): RawQuery {
  return raw;
}

function buildFamilyQueries(
  family: QueryFamily,
  request: SearchRequest,
  caps: ProviderCapabilities,
  location: LocationContext,
  profile: {
    terms: SearchTerm[];
    latin: string[];
    products: SearchTerm[];
    negatives: string[];
  },
): RawQuery[] {
  const out: RawQuery[] = [];
  const cityLoc = location.city ? location.locations[0] : null;
  const broadLoc = location.broad;
  const category = normalizeText(request.category);
  const push = (item: RawQuery) => {
    const text = normalizeQueryText(item.query);
    if (text) out.push(q({ ...item, query: text }));
  };

  switch (family) {
    case "exact_category": {
      for (const termItem of profile.terms.filter((t) => t.relation === "exact" || t.relation === "synonym")) {
        const relevance = termItem.relation === "exact" ? 1 : 0.85;
        for (const loc of location.mixed.slice(0, 2)) {
          const specificity = cityLoc && loc === cityLoc ? 1 : 0.6;
          push({
            query: siteScoped(caps, "instagram.com", `"${termItem.term}" ${loc}`),
            family,
            term: termItem.term,
            location: loc,
            commercialIntent: 0.45,
            locationSpecificity: specificity,
            categoryRelevance: relevance,
            expectedValue: FAMILY_BASE_VALUE.exact_category * termItem.confidence,
          });
        }
        push({
          query: `"${termItem.term}" ${cityLoc ?? broadLoc} اینستاگرام`,
          family,
          term: termItem.term,
          location: cityLoc ?? broadLoc,
          commercialIntent: 0.4,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: relevance,
          expectedValue: 0.6 * termItem.confidence,
        });
      }
      // Many local businesses brand themselves in Latin script.
      const latinCity = location.iran ? latinCityName(location.city) : null;
      for (const latin of profile.latin.slice(0, 2)) {
        push({
          query: siteScoped(caps, "instagram.com", `"${latin}" ${latinCity ?? cityLoc ?? broadLoc}`),
          family,
          term: latin,
          location: latinCity ?? cityLoc ?? broadLoc,
          commercialIntent: 0.45,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.8,
          expectedValue: 0.55,
        });
      }
      break;
    }

    case "commercial_intent": {
      const verbs = location.iran
        ? ["فروش", "خرید", "سفارش", "قیمت", "ارسال"]
        : ["buy", "order", "shop", "price"];
      const verbsFa = ["فروش", "خرید", "سفارش", "قیمت", "ارسال"];
      const list = location.iran ? verbsFa : verbs;
      for (const termItem of profile.terms.filter((t) => t.relation === "exact" || t.relation === "synonym").slice(0, 2)) {
        for (const verb of list.slice(0, 4)) {
          const loc = cityLoc ?? broadLoc;
          push({
            query: siteScoped(caps, "instagram.com", `"${verb} ${termItem.term}" ${loc}`),
            family,
            term: termItem.term,
            location: loc,
            commercialIntent: 1,
            locationSpecificity: cityLoc ? 1 : 0.6,
            categoryRelevance: 0.85,
            expectedValue: FAMILY_BASE_VALUE.commercial_intent,
          });
        }
      }
      break;
    }

    case "business_type": {
      const businessTerms = profile.terms.filter((t) => t.relation === "commercial").map((t) => t.term);
      const list = businessTerms.length ? businessTerms : ["فروشگاه", "فروشگاه اینترنتی"];
      for (const type of list.slice(0, 3)) {
        for (const loc of location.mixed.slice(0, 2)) {
          push({
            query: siteScoped(caps, "instagram.com", `"${type} ${category}" ${loc}`),
            family,
            term: type,
            location: loc,
            commercialIntent: 0.9,
            locationSpecificity: cityLoc && loc === cityLoc ? 1 : 0.6,
            categoryRelevance: 0.8,
            expectedValue: FAMILY_BASE_VALUE.business_type,
          });
          push({
            query: `"${type} ${category}" ${loc}`,
            family,
            term: type,
            location: loc,
            commercialIntent: 0.9,
            locationSpecificity: cityLoc && loc === cityLoc ? 1 : 0.6,
            categoryRelevance: 0.8,
            expectedValue: FAMILY_BASE_VALUE.business_type * 0.9,
          });
        }
      }
      break;
    }

    case "contact_channel": {
      const loc = cityLoc ?? broadLoc;
      const phrases = location.iran
        ? ["سفارش از دایرکت", "برای قیمت دایرکت", "ثبت سفارش واتساپ", "سفارش تلگرام"]
        : ["order via dm", "whatsapp order", "contact"];
      for (const phrase of phrases.slice(0, 3)) {
        push({
          query: siteScoped(caps, "instagram.com", `"${phrase}" ${category} ${loc}`),
          family,
          term: category,
          location: loc,
          commercialIntent: 0.85,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.7,
          expectedValue: FAMILY_BASE_VALUE.contact_channel,
        });
      }
      for (const channel of location.iran ? ["واتساپ", "تلگرام"] : ["whatsapp", "telegram"]) {
        push({
          query: `"${category}" ${loc} ${channel}`,
          family,
          term: category,
          location: loc,
          commercialIntent: 0.8,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.7,
          expectedValue: FAMILY_BASE_VALUE.contact_channel * 0.9,
        });
      }
      break;
    }

    case "product_specific": {
      if (!profile.products.length) break;
      const loc = cityLoc ?? broadLoc;
      for (const product of profile.products.slice(0, 4)) {
        push({
          query: `"${product.term}" ${loc} فروشگاه`,
          family,
          term: product.term,
          location: loc,
          commercialIntent: 0.6,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.6,
          expectedValue: FAMILY_BASE_VALUE.product_specific * product.confidence,
        });
      }
      const top = profile.products[0];
      if (top) {
        push({
          query: siteScoped(caps, "instagram.com", `"${top.term}" ${loc} فروش`),
          family,
          term: top.term,
          location: loc,
          commercialIntent: 0.7,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.6,
          expectedValue: FAMILY_BASE_VALUE.product_specific,
        });
      }
      break;
    }

    case "website": {
      const loc = cityLoc ?? broadLoc;
      const suffixes = location.iran ? ["فروشگاه", "سایت", "فروش آنلاین", "سایت رسمی"] : ["shop", "official site", "online store"];
      for (const suffix of suffixes.slice(0, 3)) {
        push({
          query: `"${category}" ${loc} ${suffix}`,
          family,
          term: category,
          location: loc,
          commercialIntent: 0.7,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.7,
          expectedValue: FAMILY_BASE_VALUE.website,
        });
      }
      break;
    }

    case "domain": {
      if (!caps.siteOperator) break;
      const tld = location.iran ? ".ir" : ".com";
      for (const termItem of profile.terms.filter((t) => t.relation === "exact" || t.relation === "synonym").slice(0, 2)) {
        const loc = cityLoc ?? broadLoc;
        push({
          query: `site:${tld} "${termItem.term}" ${loc}`,
          family,
          term: termItem.term,
          location: loc,
          commercialIntent: 0.6,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.7,
          expectedValue: FAMILY_BASE_VALUE.domain,
        });
      }
      break;
    }

    case "directory": {
      const loc = cityLoc ?? broadLoc;
      const cues = location.iran ? ["آدرس", "تماس", "فروشگاه"] : ["address", "contact", "store"];
      for (const cue of cues.slice(0, 3)) {
        push({
          query: `"${category}" "${loc}" "${cue}"`,
          family,
          term: category,
          location: loc,
          commercialIntent: 0.55,
          locationSpecificity: cityLoc ? 1 : 0.6,
          categoryRelevance: 0.65,
          expectedValue: FAMILY_BASE_VALUE.directory,
        });
      }
      break;
    }

    case "location_focus": {
      if (!location.city) break;
      const city = location.city;
      const areaCode = location.iran ? cityAreaCode(city) : null;
      const cues = location.iran
        ? ["فروشگاه", "آدرس", "تومان"]
        : ["store", "address", "price"];
      for (const cue of cues.slice(0, 3)) {
        push({
          query: `"${category}" ${city} ${cue}`,
          family,
          term: category,
          location: city,
          commercialIntent: 0.6,
          locationSpecificity: 1,
          categoryRelevance: 0.7,
          expectedValue: FAMILY_BASE_VALUE.location_focus,
        });
      }
      push({
        query: `"${category}" "${city}" "آدرس"`,
        family,
        term: category,
        location: city,
        commercialIntent: 0.5,
        locationSpecificity: 1,
        categoryRelevance: 0.65,
        expectedValue: FAMILY_BASE_VALUE.location_focus,
      });
      if (areaCode) {
        push({
          query: withNegatives(caps, `"${category}" تلفن ${areaCode}`, profile.negatives),
          family,
          term: category,
          location: city,
          commercialIntent: 0.6,
          locationSpecificity: 1,
          categoryRelevance: 0.6,
          expectedValue: FAMILY_BASE_VALUE.location_focus,
        });
      }
      break;
    }

    case "follow_up":
    case "adaptive":
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Ranking + diversity
// ---------------------------------------------------------------------------

function scoreQuery(item: RawQuery, diversityScore: number): SearchQuery {
  const priority = Math.round(
    100 *
      (0.3 * item.expectedValue +
        0.22 * item.commercialIntent +
        0.18 * item.locationSpecificity +
        0.15 * item.categoryRelevance +
        0.15 * diversityScore),
  );
  return {
    ...item,
    round: 0,
    mode: "exploration",
    diversityScore,
    priority,
  };
}

/**
 * Assigns a diversity score to each query: 1 for the first occurrence of a
 * pattern, dropping toward 0 for queries that repeat an already-selected intent.
 */
export function diversify(scores: SearchQuery[], threshold = 0.8): SearchQuery[] {
  const selected: string[] = [];
  const out: SearchQuery[] = [];
  for (const item of scores) {
    let maxSimilarity = 0;
    for (const other of selected) {
      maxSimilarity = Math.max(maxSimilarity, querySimilarity(item.query, other));
    }
    if (maxSimilarity >= threshold) continue; // effectively a duplicate query
    selected.push(item.query);
    out.push({ ...item, diversityScore: Number((1 - maxSimilarity).toFixed(3)) });
  }
  return out;
}

export function rankQueries(queries: SearchQuery[]): SearchQuery[] {
  return diversify(queries)
    .map((item) => scoreQuery(item, item.diversityScore))
    .sort((a, b) => b.priority - a.priority || a.query.localeCompare(b.query));
}

// ---------------------------------------------------------------------------
// Plan + rounds
// ---------------------------------------------------------------------------

export function buildQueryPlan(request: SearchRequest, options: PlanOptions): SearchQuery[] {
  const location = buildLocationContext(request);
  const caps = options.capabilities;
  const profile = {
    terms: coreTerms(request.category, 3),
    latin: latinTerms(request.category, 2),
    products: productTerms(request.category, 4),
    negatives: negativeTerms(request.category, 3),
  };

  const families: QueryFamily[] = [
    "exact_category",
    "commercial_intent",
    "business_type",
    "contact_channel",
    "product_specific",
    "website",
    "domain",
    "directory",
    "location_focus",
  ];

  const byFamily = new Map<QueryFamily, SearchQuery[]>();
  for (const family of families) {
    const raw = buildFamilyQueries(family, request, caps, location, profile);
    const scored = rankQueries(
      raw.map((item) => ({
        ...scoreQuery(item, 1),
        family,
      })),
    );
    byFamily.set(family, scored);
  }

  const plan: SearchQuery[] = [];
  const cursor = new Map<QueryFamily, number>();
  const maxRound = Math.max(1, options.maxRounds);

  for (const entry of ROUND_SCHEDULE) {
    if (entry.round > maxRound) continue;
    const pool = byFamily.get(entry.family) ?? [];
    const start = cursor.get(entry.family) ?? 0;
    const slice = pool.slice(start, start + entry.count);
    cursor.set(entry.family, start + slice.length);
    for (const item of slice) {
      plan.push({ ...item, round: entry.round, mode: "exploration" });
    }
  }

  // Leftovers go to the last round so budget is never wasted on duplicates.
  for (const [family, pool] of byFamily) {
    const used = cursor.get(family) ?? 0;
    for (const item of pool.slice(used)) {
      plan.push({ ...item, round: maxRound, mode: "exploration" });
    }
  }

  return dedupePlan(plan);
}

/**
 * Removes identical queries and cross-family near-duplicates
 * (same token set ⇒ the provider is asked essentially the same thing).
 * Higher-priority queries win; round assignment is preserved.
 */
function dedupePlan(plan: SearchQuery[]): SearchQuery[] {
  const byText = new Map<string, SearchQuery>();
  for (const item of plan) {
    const key = item.query.toLowerCase();
    const existing = byText.get(key);
    if (!existing || item.priority > existing.priority) byText.set(key, item);
  }
  const candidates = [...byText.values()].sort((a, b) => b.priority - a.priority);
  const kept: SearchQuery[] = [];
  for (const item of candidates) {
    const duplicate = kept.some((other) => querySimilarity(other.query, item.query) >= 0.999);
    if (duplicate) continue;
    kept.push(item);
  }
  return kept.sort((a, b) => a.round - b.round || b.priority - a.priority);
}

/** Groups a plan into round buckets (index 0 = round 1). */
export function planRounds(request: SearchRequest, options: PlanOptions): SearchQuery[][] {
  const maxRound = Math.max(1, options.maxRounds);
  const rounds: SearchQuery[][] = Array.from({ length: maxRound }, () => []);
  for (const item of buildQueryPlan(request, options)) {
    const index = Math.min(Math.max(item.round, 1), maxRound) - 1;
    rounds[index]?.push(item);
  }
  return rounds;
}

// ---------------------------------------------------------------------------
// Adaptive queries
// ---------------------------------------------------------------------------

const PATTERN_FAMILIES: Record<FailurePattern, { family: QueryFamily; boost: number }[]> = {
  TOO_MANY_FOREIGN: [
    { family: "location_focus", boost: 5 },
    { family: "domain", boost: 2 },
    { family: "directory", boost: 2 },
  ],
  TOO_MANY_PERSONAL: [
    { family: "commercial_intent", boost: 5 },
    { family: "business_type", boost: 3 },
    { family: "website", boost: 2 },
  ],
  TOO_MANY_DUPLICATES: [
    { family: "product_specific", boost: 5 },
    { family: "website", boost: 3 },
    { family: "directory", boost: 3 },
    { family: "contact_channel", boost: 2 },
  ],
  TOO_MANY_NEWS: [
    { family: "commercial_intent", boost: 4 },
    { family: "business_type", boost: 3 },
    { family: "website", boost: 2 },
  ],
  TOO_MANY_FAN_PAGES: [
    { family: "commercial_intent", boost: 4 },
    { family: "business_type", boost: 3 },
    { family: "directory", boost: 2 },
  ],
  TOO_FEW_BUSINESSES: [
    { family: "business_type", boost: 5 },
    { family: "directory", boost: 3 },
    { family: "commercial_intent", boost: 2 },
  ],
  TOO_FEW_IRANIAN_RESULTS: [
    { family: "location_focus", boost: 5 },
    { family: "domain", boost: 3 },
    { family: "directory", boost: 2 },
  ],
  TOO_FEW_CITY_MATCHES: [
    { family: "location_focus", boost: 5 },
    { family: "directory", boost: 3 },
  ],
  TOO_FEW_COMMERCIAL_RESULTS: [
    { family: "commercial_intent", boost: 5 },
    { family: "contact_channel", boost: 3 },
  ],
  LOW_CATEGORY_RELEVANCE: [
    { family: "exact_category", boost: 4 },
    { family: "product_specific", boost: 3 },
  ],
};

const LEGACY_PATTERN_ALIASES: Record<string, FailurePattern> = {
  foreign: "TOO_MANY_FOREIGN",
  influencers: "TOO_MANY_PERSONAL",
  generic_instagram: "TOO_FEW_BUSINESSES",
  duplicates: "TOO_MANY_DUPLICATES",
};

export function normalizeFailurePattern(pattern: string): FailurePattern | null {
  const upper = pattern.toUpperCase();
  if (upper in PATTERN_FAMILIES) return upper as FailurePattern;
  return LEGACY_PATTERN_ALIASES[pattern] ?? null;
}

export function adaptiveRawQueries(
  pattern: FailurePattern,
  request: SearchRequest,
  caps: ProviderCapabilities = DEFAULT_CAPABILITIES,
): RawQuery[] {
  const location = buildLocationContext(request);
  const category = normalizeText(request.category);
  const city = location.city;
  const loc = city ?? location.primary;
  const code = location.iran ? cityAreaCode(city) : null;
  const out: RawQuery[] = [];
  const add = (query: string, family: QueryFamily, commercialIntent: number, expectedValue: number) => {
    const text = normalizeQueryText(query);
    if (!text) return;
    out.push({
      query: text,
      family,
      term: category,
      location: loc ?? null,
      commercialIntent,
      locationSpecificity: city ? 1 : 0.6,
      categoryRelevance: 0.7,
      expectedValue,
    });
  };

  switch (pattern) {
    case "TOO_MANY_FOREIGN":
      add(`"${category}" آدرس ${loc ?? "ایران"}`, "location_focus", 0.6, 0.8);
      if (code) add(`"${category}" تلفن ${code}`, "location_focus", 0.6, 0.75);
      if (caps.siteOperator) add(`site:.ir "${category}" ${loc ?? "ایران"}`, "domain", 0.6, 0.7);
      add(`"${category}" تومان ${loc ?? "ایران"}`, "location_focus", 0.7, 0.7);
      if (caps.negativeTerms) {
        add(
          `"${category}" "${loc ?? "ایران"}" آدرس -dubai -istanbul -turkey -uae`,
          "location_focus",
          0.6,
          0.7,
        );
      }
      break;

    case "TOO_MANY_PERSONAL":
    case "TOO_MANY_FAN_PAGES":
    case "TOO_MANY_NEWS":
      add(`فروشگاه ${category} ${loc ?? "ایران"}`, "business_type", 0.95, 0.85);
      add(`سایت فروش ${category} ${loc ?? "ایران"}`, "website", 0.9, 0.8);
      add(`"فروش ${category}" ${loc ?? "ایران"}`, "commercial_intent", 1, 0.85);
      add(`"${category}" "ثبت سفارش" "${loc ?? "ایران"}"`, "commercial_intent", 1, 0.8);
      break;

    case "TOO_MANY_DUPLICATES":
      add(`${category} بوتیک ${loc ?? "ایران"}`, "business_type", 0.85, 0.75);
      add(`${category} برند ${loc ?? "ایران"}`, "business_type", 0.85, 0.7);
      add(`"${category}" "${loc ?? "ایران"}" "آدرس"`, "directory", 0.6, 0.7);
      add(`${category} ${loc ?? "ایران"} واتساپ سفارش`, "contact_channel", 0.85, 0.7);
      break;

    case "TOO_FEW_BUSINESSES":
      add(`فروشگاه اینترنتی ${category} ${loc ?? "ایران"}`, "business_type", 0.95, 0.85);
      add(`"${category}" "${loc ?? "ایران"}" "تماس"`, "directory", 0.6, 0.7);
      add(`فروش عمده ${category} ${loc ?? "ایران"}`, "commercial_intent", 0.95, 0.7);
      break;

    case "TOO_FEW_IRANIAN_RESULTS":
      add(`"${category}" "${loc ?? "ایران"}" "ارسال به سراسر ایران"`, "location_focus", 0.7, 0.8);
      if (caps.siteOperator) add(`site:.ir "فروشگاه ${category}"`, "domain", 0.7, 0.75);
      add(`"${category}" ایران "تومان"`, "location_focus", 0.7, 0.7);
      break;

    case "TOO_FEW_CITY_MATCHES":
      if (city) {
        add(`"${category}" "${city}" "آدرس"`, "location_focus", 0.6, 0.85);
        add(`فروشگاه ${category} ${city}`, "business_type", 0.9, 0.8);
        add(`"${category}" ${city} "تومان"`, "location_focus", 0.7, 0.75);
      }
      break;

    case "TOO_FEW_COMMERCIAL_RESULTS":
      add(`سفارش آنلاین ${category} ${loc ?? "ایران"}`, "commercial_intent", 1, 0.85);
      add(`"${category}" "${loc ?? "ایران"}" "سفارش از دایرکت"`, "contact_channel", 0.9, 0.8);
      add(`خرید آنلاین ${category} ${loc ?? "ایران"}`, "commercial_intent", 1, 0.8);
      break;

    case "LOW_CATEGORY_RELEVANCE":
      add(`"${category}" ${loc ?? "ایران"}`, "exact_category", 0.5, 0.8);
      add(`"${category}" فروشگاه ${loc ?? "ایران"}`, "business_type", 0.9, 0.75);
      break;
  }

  return out;
}

/**
 * Builds the adaptive query set for the observed failure patterns.
 * Deterministic: same patterns + request ⇒ same queries.
 */
export function adaptiveQueryPlan(
  patterns: FailurePattern[],
  request: SearchRequest,
  options: PlanOptions,
  executedQueries: string[] = [],
  limit = 6,
): SearchQuery[] {
  const caps = options.capabilities;
  const executed = new Set(executedQueries.map((value) => value.toLowerCase()));
  const raw: RawQuery[] = [];
  for (const pattern of patterns) {
    raw.push(...adaptiveRawQueries(pattern, request, caps));
  }
  const ranked = rankQueries(
    raw.map((item) => ({
      ...scoreQuery(item, 1),
      family: item.family,
      round: ADAPTIVE_ROUND,
      mode: "exploitation" as const,
    })),
  );
  return ranked.filter((item) => !executed.has(item.query.toLowerCase())).slice(0, limit);
}

/**
 * Follow-up searches for promising candidates with weak evidence:
 * looks for an official website / business identity in public sources.
 * Never logs into Instagram and never fetches private pages.
 */
export function followUpQueries(
  candidates: Candidate[],
  request: SearchRequest,
  options: PlanOptions,
  executedQueries: string[] = [],
  limit = 4,
): SearchQuery[] {
  const executed = new Set(executedQueries.map((value) => value.toLowerCase()));
  const location = buildLocationContext(request);
  const loc = location.city ?? location.primary;
  const raw: RawQuery[] = [];
  const push = (query: string, term: string) => {
    const text = normalizeQueryText(query);
    if (!text || executed.has(text.toLowerCase())) return;
    if (raw.some((item) => item.query === text)) return;
    raw.push({
      query: text,
      family: "follow_up",
      term,
      location: loc ?? null,
      commercialIntent: 0.5,
      locationSpecificity: citySpecificity(query, location.city),
      categoryRelevance: 0.7,
      expectedValue: FAMILY_BASE_VALUE.follow_up,
    });
  };

  const weak = candidates
    .filter((candidate) => !candidate.website || (candidate.sourceUrls?.length ?? 0) < 2)
    .slice(0, 4);

  for (const candidate of weak) {
    if (raw.length >= limit) break;
    const username = candidate.username?.trim();
    const name = candidate.businessName?.trim();
    if (username && /^[a-z0-9._]{3,30}$/i.test(username)) {
      push(`"${username}" ${loc ?? ""}`.trim(), username);
      push(`"${username}" website`, username);
    }
    if (name && name.length > 2 && name.length < 40) {
      push(`"${name}" ${loc ?? ""}`.trim(), name);
    }
  }

  return rankQueries(
    raw.map((item) => ({
      ...scoreQuery(item, 1),
      family: item.family,
      round: ADAPTIVE_ROUND,
      mode: "exploitation" as const,
    })),
  ).slice(0, limit);
}

function citySpecificity(query: string, city: string | null): number {
  return city && query.includes(city) ? 1 : 0.5;
}

// ---------------------------------------------------------------------------
// Back-compatible flat helpers (used by older call sites and tests)
// ---------------------------------------------------------------------------

export function generateSearchQueries(request: SearchRequest, extra: string[] = []): string[] {
  const plan = buildQueryPlan(request, {
    capabilities: DEFAULT_CAPABILITIES,
    maxRounds: 7,
    queriesPerRound: 12,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...plan.map((p) => p.query), ...extra]) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function adaptiveQueries(
  pattern: string,
  request: SearchRequest,
  options: PlanOptions = {
    capabilities: DEFAULT_CAPABILITIES,
    maxRounds: 7,
    queriesPerRound: 12,
  },
): string[] {
  const normalized = normalizeFailurePattern(pattern);
  if (!normalized) return [];
  return adaptiveQueryPlan([normalized], request, options).map((item) => item.query);
}
