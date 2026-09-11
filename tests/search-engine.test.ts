import { describe, expect, it } from "vitest";
import type { SearchResultItem } from "@/types/lead";
import { SearchEngine } from "@/lib/search/engine";
import {
  adaptiveQueries,
  adaptiveQueryPlan,
  buildQueryPlan,
  generateSearchQueries,
  planRounds,
  rankQueries,
  type PlanOptions,
} from "@/lib/search/queryPlan";
import {
  canonicalizeUrl,
  matchKey,
  normalizeText,
  normalizeQueryText,
  querySimilarity,
} from "@/lib/search/normalize";
import { extractCandidates } from "@/lib/search/discovery";
import { earlyReject } from "@/lib/search/signals";
import { MockSearchProvider, SearchProviderError } from "@/lib/search/provider";
import { fakeProvider } from "./helpers";

const PLAN_OPTIONS: PlanOptions = {
  capabilities: { siteOperator: true, negativeTerms: true, maxResultsPerQuery: 10 },
  maxRounds: 7,
  queriesPerRound: 12,
};

const REQUEST = { category: "لوازم آرایشی", country: "ایران", city: "تهران", limit: 20 };

function shop(user: string, extra = ""): SearchResultItem {
  return {
    title: `فروشگاه ${user} تهران`,
    url: `https://www.instagram.com/${user}`,
    snippet: `فروشگاه لوازم آرایشی تهران. سفارش از دایرکت و واتساپ. قیمت به تومان. آدرس: ولیعصر، تهران. ${extra}`,
    query: "q",
    provider: "fake",
  };
}

async function drain(
  engine: SearchEngine,
  opts: { maxRounds?: number; onRound?: (round: number, candidates: number) => void } = {},
) {
  const limit = opts.maxRounds ?? 12;
  for (let i = 0; i < limit; i += 1) {
    if (!engine.hasMoreRounds()) break;
    const outcome = await engine.runNextRound();
    opts.onRound?.(outcome.round, outcome.totalCandidates);
    if (engine.isStopped()) break;
    if (!outcome.queriesExecuted && outcome.stopReason) break;
  }
  return engine.diagnostics;
}

// ---------------------------------------------------------------------------
// §8 request normalization
// ---------------------------------------------------------------------------

describe("normalization", () => {
  it("folds Persian/Arabic variants, zero-width chars and whitespace", () => {
    expect(normalizeText("لوازم  آرايشي")).toBe("لوازم آرایشی");
    expect(normalizeText("آرایشی")).toBe("آرایشی");
    expect(normalizeText("تهران\u200c")).toBe("تهران");
    expect(matchKey("Beauty  Shop!")).toBe("beauty shop");
  });

  it("keeps the category semantically equivalent after normalization", () => {
    expect(normalizeText("لوازم آرایشی")).toBe("لوازم آرایشی");
    expect(matchKey("لوازم آرایشی")).toBe(matchKey("لوازم آرايشى"));
  });

  it("treats equivalent query spellings as the same query (§92)", () => {
    const a = normalizeQueryText('"فروشگاه آرایشی تهران"');
    const b = normalizeQueryText("فروشگاه آرایشی تهران");
    expect(querySimilarity(a, b)).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// §20 / §84 URL canonicalization
// ---------------------------------------------------------------------------

describe("url canonicalization", () => {
  it("resolves instagram profile variants to one profile", () => {
    const variants = [
      "https://instagram.com/shop",
      "https://instagram.com/shop/",
      "https://www.instagram.com/shop",
      "https://www.instagram.com/shop/?utm_source=ig",
    ];
    const keys = new Set(variants.map((url) => canonicalizeUrl(url)?.key));
    expect(keys.size).toBe(1);
    expect(canonicalizeUrl("https://www.instagram.com/Shop/")?.instagramUsername).toBe("shop");
  });

  it("strips tracking params and fragments but keeps meaningful paths", () => {
    expect(canonicalizeUrl("https://shop.ir/about?utm_source=x&fbclid=1#top")?.url).toBe(
      "https://shop.ir/about",
    );
    expect(canonicalizeUrl("https://shop.ir/")?.url).toBe("https://shop.ir/");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("does not mistake instagram post/reel URLs for profiles", () => {
    expect(canonicalizeUrl("https://www.instagram.com/p/ABC123/")?.isInstagramProfile).toBe(false);
    expect(canonicalizeUrl("https://www.instagram.com/reel/xyz/")?.isInstagramProfile).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §13-§18 query families, diversity, ranking
// ---------------------------------------------------------------------------

describe("query planning", () => {
  it("generates multiple query families including city and website discovery", () => {
    const plan = buildQueryPlan(REQUEST, PLAN_OPTIONS);
    const families = new Set(plan.map((item) => item.family));
    expect(families.has("exact_category")).toBe(true);
    expect(families.has("commercial_intent")).toBe(true);
    expect(families.has("business_type")).toBe(true);
    expect(families.has("website")).toBe(true);
    expect(families.has("directory")).toBe(true);
    expect(plan.some((item) => item.query.includes("تهران"))).toBe(true);
    expect(plan.some((item) => item.query.includes("site:instagram.com"))).toBe(true);
    expect(plan.some((item) => !item.query.includes("site:"))).toBe(true);
  });

  it("produces city-specific queries before country-only queries", () => {
    const plan = rankQueries(buildQueryPlan(REQUEST, PLAN_OPTIONS));
    const firstCity = plan.findIndex((item) => item.locationSpecificity === 1);
    const firstCountry = plan.findIndex((item) => item.locationSpecificity < 1);
    expect(firstCity).toBeGreaterThanOrEqual(0);
    expect(firstCity).toBeLessThan(firstCountry);
  });

  it("avoids near-duplicate queries (§14, §79)", () => {
    const plan = buildQueryPlan(REQUEST, PLAN_OPTIONS);
    for (let i = 0; i < plan.length; i += 1) {
      for (let j = i + 1; j < plan.length; j += 1) {
        expect(querySimilarity(plan[i]!.query, plan[j]!.query)).toBeLessThan(0.999);
      }
    }
    const queries = plan.map((item) => item.query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("is deterministic: same input ⇒ same queries (§75, §76)", () => {
    const a = buildQueryPlan(REQUEST, PLAN_OPTIONS).map((item) => item.query);
    const b = buildQueryPlan(REQUEST, PLAN_OPTIONS).map((item) => item.query);
    expect(a).toEqual(b);
  });

  it("adapts queries to provider capabilities (no provider logic in core)", () => {
    const noOperators = buildQueryPlan(REQUEST, {
      ...PLAN_OPTIONS,
      capabilities: { siteOperator: false, negativeTerms: false, maxResultsPerQuery: 10 },
    });
    expect(noOperators.every((item) => !item.query.includes("site:"))).toBe(true);
    expect(noOperators.some((item) => item.query.includes("instagram.com"))).toBe(true);
    expect(noOperators.some((item) => item.family === "domain")).toBe(false);
  });

  it("schedules several search rounds with mixed families", () => {
    const rounds = planRounds(REQUEST, PLAN_OPTIONS);
    expect(rounds.length).toBe(7);
    expect(rounds[0]!.length).toBeGreaterThan(0);
    const roundOneFamilies = new Set(rounds[0]!.map((item) => item.family));
    expect(roundOneFamilies.size).toBeGreaterThanOrEqual(3);
    expect(rounds.flat().length).toBeGreaterThan(20);
  });

  it("keeps a back-compatible flat query list", () => {
    const queries = generateSearchQueries(REQUEST);
    expect(queries.length).toBeGreaterThan(8);
    expect(queries.some((q) => q.includes("site:instagram.com"))).toBe(true);
    expect(queries.some((q) => q.includes("دایرکت") || q.includes("فروشگاه اینترنتی"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §31 adaptive queries
// ---------------------------------------------------------------------------

describe("adaptive queries", () => {
  it("adds location-focused queries when results look foreign (§80)", () => {
    const queries = adaptiveQueries("TOO_MANY_FOREIGN", REQUEST, PLAN_OPTIONS);
    expect(queries.some((q) => q.includes("021") || q.includes(".ir"))).toBe(true);
  });

  it("adds commercial-intent queries when results look personal", () => {
    const queries = adaptiveQueries("TOO_MANY_PERSONAL", REQUEST, PLAN_OPTIONS);
    expect(queries.some((q) => q.includes("فروشگاه") || q.includes("سفارش"))).toBe(true);
  });

  it("switches family when results are mostly duplicates", () => {
    const queries = adaptiveQueryPlan(["TOO_MANY_DUPLICATES"], REQUEST, PLAN_OPTIONS);
    expect(queries.some((item) => item.family !== "exact_category")).toBe(true);
  });

  it("never repeats an already executed query", () => {
    const first = adaptiveQueryPlan(["TOO_MANY_FOREIGN"], REQUEST, PLAN_OPTIONS).map((i) => i.query);
    const second = adaptiveQueryPlan(["TOO_MANY_FOREIGN"], REQUEST, PLAN_OPTIONS, first).map(
      (i) => i.query,
    );
    expect(second.some((q) => first.includes(q))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §83 cross-query deduplication
// ---------------------------------------------------------------------------

describe("candidate deduplication", () => {
  it("merges the same account found by different queries into one candidate", async () => {
    const { provider, calls } = fakeProvider(() => [shop("shop1")]);
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    await drain(engine, { maxRounds: 2 });
    expect(engine.candidates.length).toBe(1);
    expect(engine.candidates[0]!.username).toBe("shop1");
    expect(new Set(calls).size).toBe(calls.length); // no repeated query (§92)
  });

  it("deduplicates instagram URL variants", () => {
    const candidates = extractCandidates([
      { ...shop("shop1"), url: "https://www.instagram.com/Shop1/" },
      { ...shop("shop1"), url: "https://instagram.com/shop1?utm_source=x" },
    ]);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.username).toBe("shop1");
    expect(candidates[0]!.discoverySources).toContain("instagram_profile");
  });

  it("merges a business found through Instagram and its own website", () => {
    const candidates = extractCandidates([
      {
        title: "رخت‌نگار | فروشگاه اینترنتی",
        url: "https://www.instagram.com/rakhtnegar",
        snippet: "فروشگاه پوشاک تهران سایت https://rakhtnegar.ir",
        query: "q",
        provider: "fake",
      },
      {
        title: "رخت‌نگار | فروشگاه اینترنتی",
        url: "https://rakhtnegar.ir",
        snippet: "فروشگاه اینترنتی پوشاک تهران",
        query: "q2",
        provider: "fake",
      },
    ]);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.discoverySources.length).toBeGreaterThan(1);
    expect(candidates[0]!.discoveryQueries.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §82 historical deduplication
// ---------------------------------------------------------------------------

describe("historical deduplication", () => {
  it("does not return leads that are already stored", async () => {
    const { provider } = fakeProvider(() => [shop("beautyshop"), shop("newshop")]);
    const historical = [
      { username: "beautyshop", instagramUrl: "https://www.instagram.com/beautyshop" },
    ];
    const engine = new SearchEngine({
      request: REQUEST,
      provider: provider as never,
      historical: historical as never,
    });
    const diagnostics = await drain(engine, { maxRounds: 2 });
    const usernames = engine.candidates.map((candidate) => candidate.username);
    expect(usernames).toContain("newshop");
    expect(usernames).not.toContain("beautyshop");
    expect(diagnostics.historicalDuplicates).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §34 stopping conditions
// ---------------------------------------------------------------------------

describe("stopping conditions", () => {
  it("stops when enough qualified leads exist", async () => {
    const { provider } = fakeProvider(() => [shop("shop1")]);
    const engine = new SearchEngine({
      request: { ...REQUEST, limit: 1 },
      provider: provider as never,
      historical: [],
    });
    await engine.runNextRound();
    engine.noteQualified(1);
    expect(engine.diagnostics.stopReason).toBe("ENOUGH_QUALIFIED_LEADS");
    await engine.runNextRound();
    expect(engine.diagnostics.stopReason).toBe("ENOUGH_QUALIFIED_LEADS");
  });

  it("stops on diminishing returns (§81)", async () => {
    let served = 0;
    const { provider } = fakeProvider(() => {
      served += 1;
      return served <= 4 ? [shop(`shop${served}`)] : [];
    });
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    const diagnostics = await drain(engine);
    expect(diagnostics.stopReason).toBe("DIMINISHING_RETURNS");
    expect(diagnostics.candidates).toBeLessThanOrEqual(4);
  });

  it("stops when the query budget is exhausted", async () => {
    let served = 0;
    const { provider } = fakeProvider(() => {
      served += 1;
      return [shop(`shop${served}`)];
    });
    const engine = new SearchEngine({
      request: REQUEST,
      provider: provider as never,
      historical: [],
      budget: { maxQueries: 6, maxRounds: 7 },
    });
    const diagnostics = await drain(engine);
    expect(diagnostics.stopReason).toBe("SEARCH_BUDGET_EXHAUSTED");
    expect(diagnostics.queriesExecuted).toBeLessThanOrEqual(6);
  });

  it("reports NO_RESULTS when nothing is found (§86)", async () => {
    const { provider } = fakeProvider(() => []);
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    const diagnostics = await drain(engine);
    expect(diagnostics.candidates).toBe(0);
    expect(diagnostics.stopReason).toBe("NO_RESULTS");
    expect(diagnostics.partialSearch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §65 / §85 provider failures
// ---------------------------------------------------------------------------

describe("provider failure", () => {
  it("returns no fake results and a clear failure state", async () => {
    const { provider } = fakeProvider(() => [], {
      failWith: new Error("network down"),
    });
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    const diagnostics = await drain(engine);
    expect(diagnostics.candidates).toBe(0);
    expect(diagnostics.stopReason).toBe("PROVIDER_FAILURE");
    expect(diagnostics.partialSearch).toBe(true);
    expect(diagnostics.providerErrors.length).toBeGreaterThan(0);
  });

  it("respects rate limits instead of retrying through them", async () => {
    const { provider, calls } = fakeProvider(() => [], {
      failWith: new SearchProviderError("PROVIDER_RATE_LIMIT", "rate limited"),
    });
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    const diagnostics = await drain(engine);
    expect(diagnostics.stopReason).toBe("PROVIDER_LIMIT");
    expect(diagnostics.partialSearch).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(12);
  });

  it("preserves partial results when some queries fail", async () => {
    let served = 0;
    const { provider } = fakeProvider(() => {
      served += 1;
      if (served > 4) throw new Error("boom");
      return [shop(`shop${served}`)];
    });
    const engine = new SearchEngine({ request: REQUEST, provider: provider as never, historical: [] });
    const diagnostics = await drain(engine);
    expect(diagnostics.candidates).toBeGreaterThan(0);
    expect(diagnostics.partialSearch).toBe(true);
    expect(diagnostics.queriesFailed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// §87 never fabricate
// ---------------------------------------------------------------------------

describe("no fabrication", () => {
  it("returns fewer candidates than requested instead of inventing them", async () => {
    let served = 0;
    const { provider } = fakeProvider(() => {
      served += 1;
      return served <= 7 ? [shop(`shop${served}`)] : [];
    });
    const engine = new SearchEngine({
      request: { ...REQUEST, limit: 20 },
      provider: provider as never,
      historical: [],
    });
    const diagnostics = await drain(engine);
    expect(diagnostics.candidates).toBeLessThanOrEqual(7);
    expect(diagnostics.candidates).toBeLessThan(20);
  });

  it("drops obvious noise and foreign results early", () => {
    const news = extractCandidates([
      {
        title: "مقاله درباره لوازم آرایشی",
        url: "https://news.example.com/article",
        snippet: "مقاله خبری درباره بازار لوازم آرایشی",
        query: "q",
        provider: "fake",
      },
    ])[0]!;
    expect(earlyReject(news, { category: "لوازم آرایشی" }).reject).toBe(true);

    const foreign = extractCandidates([
      {
        title: "Dubai Glow",
        url: "https://www.instagram.com/dubaiglow",
        snippet: "UAE cosmetics brand in Dubai shipping from Dubai",
        query: "q",
        provider: "fake",
      },
    ])[0]!;
    expect(earlyReject(foreign, { category: "لوازم آرایشی", city: "تهران" }).reason).toBe("FOREIGN");

    const business = extractCandidates([shop("goodshop")])[0]!;
    expect(earlyReject(business, { category: "لوازم آرایشی", city: "تهران" }).reject).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

describe("observability", () => {
  it("records per-query and per-family statistics", async () => {
    const { provider } = fakeProvider((query) =>
      query.includes("فروش") ? [shop("a"), shop("b")] : [shop("c")],
    );
    const engine = new SearchEngine({
      request: REQUEST,
      provider: provider as never,
      historical: [],
      budget: { maxQueries: 12, maxRounds: 3 },
    });
    const diagnostics = await drain(engine);
    expect(diagnostics.queriesExecuted).toBeGreaterThan(0);
    expect(diagnostics.familyStats.length).toBeGreaterThan(0);
    expect(diagnostics.familyStats[0]!.executed).toBeGreaterThan(0);
    expect(engine.queryStats.every((stat) => typeof stat.resultCount === "number")).toBe(true);
    expect(typeof diagnostics.stopReason).toBe("string");
  });

  it("emits round progress events", async () => {
    const events: string[] = [];
    const { provider } = fakeProvider(() => [shop("a")]);
    const engine = new SearchEngine({
      request: REQUEST,
      provider: provider as never,
      historical: [],
      onProgress: (event) => {
        events.push(event.kind);
      },
    });
    await drain(engine, { maxRounds: 2 });
    expect(events).toContain("round_start");
    expect(events).toContain("query");
    expect(events).toContain("round_done");
  });
});

// ---------------------------------------------------------------------------
// Mock provider behaviour
// ---------------------------------------------------------------------------

describe("mock provider", () => {
  it("is labeled as mock and deterministic per query", async () => {
    const provider = new MockSearchProvider();
    expect(provider.isMock).toBe(true);
    const a = await provider.search('site:instagram.com "لوازم آرایشی" تهران');
    const b = await provider.search('site:instagram.com "لوازم آرایشی" تهران');
    expect(a.map((item) => item.url)).toEqual(b.map((item) => item.url));
    expect(a.length).toBeGreaterThan(0);
  });

  it("returns different candidates for different queries", async () => {
    const provider = new MockSearchProvider();
    const a = await provider.search('site:instagram.com "لوازم آرایشی" تهران');
    const b = await provider.search('site:instagram.com "رژ لب" تهران');
    expect(a.map((i) => i.url).join()).not.toEqual(b.map((i) => i.url).join());
  });
});
