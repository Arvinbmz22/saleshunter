import type { SearchResultItem } from "@/types/lead";
import type { ProviderCapabilities } from "@/types/search";

export interface SearchProvider {
  readonly name: string;
  /** True only for the labeled development mock (never a substitute for real search). */
  readonly isMock: boolean;
  readonly capabilities: ProviderCapabilities;
  search(query: string): Promise<SearchResultItem[]>;
}

export type SearchProviderErrorCode =
  | "SEARCH_PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_NETWORK"
  | "PROVIDER_HTTP"
  | "PROVIDER_MALFORMED";

/** Provider failure that must be reported transparently — never faked. */
export class SearchProviderError extends Error {
  readonly code: SearchProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: SearchProviderErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "SearchProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SearchProviderError(
      "SEARCH_PROVIDER_UNAVAILABLE",
      `Missing required environment variable: ${name}`,
    );
  }
  return value;
}

function timeoutMs(): number {
  const raw = Number(process.env.SEARCH_TIMEOUT_MS ?? 12_000);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 3_000), 60_000) : 12_000;
}

function resultsPerQuery(cap: number): number {
  const raw = Number(process.env.SEARCH_RESULTS_PER_QUERY ?? 10);
  const value = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 3), 20) : 10;
  return Math.min(value, cap);
}

function classifyStatus(status: number): SearchProviderError {
  if (status === 408 || status === 504) {
    return new SearchProviderError("PROVIDER_TIMEOUT", `Search provider timed out (${status})`, true);
  }
  if (status === 429 || status === 503) {
    // Rate limits are respected, never bypassed.
    return new SearchProviderError("PROVIDER_RATE_LIMIT", `Search provider rate limited (${status})`);
  }
  if (status >= 500) {
    return new SearchProviderError("PROVIDER_HTTP", `Search provider error (${status})`, true);
  }
  return new SearchProviderError("PROVIDER_HTTP", `Search provider rejected the request (${status})`);
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new SearchProviderError("PROVIDER_TIMEOUT", "Search provider timed out", true);
    }
    throw new SearchProviderError(
      "PROVIDER_NETWORK",
      error instanceof Error ? error.message : "Search provider network failure",
      true,
    );
  }
  if (!response.ok) throw classifyStatus(response.status);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SearchProviderError("PROVIDER_MALFORMED", "Search provider returned malformed JSON");
  }
}

// ---------------------------------------------------------------------------
// Real providers
// ---------------------------------------------------------------------------

class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  readonly isMock = false;
  readonly capabilities: ProviderCapabilities = {
    siteOperator: false,
    negativeTerms: false,
    maxResultsPerQuery: 20,
  };

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("TAVILY_API_KEY");
    const data = await fetchJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: resultsPerQuery(this.capabilities.maxResultsPerQuery),
        search_depth: "basic",
      }),
    });
    const parsed = data as { results?: { title?: string; url?: string; content?: string }[] };
    return (parsed.results ?? [])
      .filter((item) => typeof item.url === "string" && item.url)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.content ?? "",
        query,
        provider: this.name,
      }));
  }
}

class SerperSearchProvider implements SearchProvider {
  readonly name = "serper";
  readonly isMock = false;
  readonly capabilities: ProviderCapabilities = {
    siteOperator: true,
    negativeTerms: true,
    maxResultsPerQuery: 20,
  };

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("SERPER_API_KEY");
    const data = await fetchJson("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: query, num: resultsPerQuery(this.capabilities.maxResultsPerQuery) }),
    });
    const parsed = data as { organic?: { title?: string; link?: string; snippet?: string }[] };
    return (parsed.organic ?? [])
      .filter((item) => typeof item.link === "string" && item.link)
      .map((item) => ({
        title: item.title ?? "",
        url: item.link ?? "",
        snippet: item.snippet ?? "",
        query,
        provider: this.name,
      }));
  }
}

class BraveSearchProvider implements SearchProvider {
  readonly name = "brave";
  readonly isMock = false;
  readonly capabilities: ProviderCapabilities = {
    siteOperator: true,
    negativeTerms: true,
    maxResultsPerQuery: 20,
  };

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("BRAVE_API_KEY");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(resultsPerQuery(this.capabilities.maxResultsPerQuery)));
    const data = await fetchJson(url.toString(), {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
    });
    const parsed = data as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (parsed.web?.results ?? [])
      .filter((item) => typeof item.url === "string" && item.url)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.description ?? "",
        query,
        provider: this.name,
      }));
  }
}

// ---------------------------------------------------------------------------
// Labeled mock provider (development / tests only)
// ---------------------------------------------------------------------------

type Fixture = { title: string; url: string; snippet: string };

const COSMETICS: Fixture[] = [
  {
    title: "گل‌بوته آرایشی تهران | Instagram",
    url: "https://www.instagram.com/golboteh_beauty",
    snippet:
      "فروشگاه لوازم آرایشی تهران. ارسال به سراسر ایران. قیمت به تومان. سفارش از دایرکت و واتساپ ۰۹۱۲۳۴۵۶۷۸۹. آدرس: ولیعصر، تهران. سایت: https://golboteh.ir",
  },
  {
    title: "گل‌بوته | فروشگاه اینترنتی آرایشی",
    url: "https://golboteh.ir",
    snippet:
      "فروشگاه اینترنتی لوازم آرایشی ایرانی. آدرس: خیابان ولیعصر، تهران. تلفن: ۰۲۱۸۸۷۷۶۶۵۵. پرداخت ریالی و ارسال به سراسر ایران.",
  },
  {
    title: "نیلوفر کازمتیکس | Instagram",
    url: "https://www.instagram.com/niloofar_cosmetics",
    snippet:
      "فروشگاه محصولات آرایشی و مراقبت پوست در تهران. ارسال فوری. سفارش از دایرکت و تلگرام. آدرس: جردن، تهران. سایت https://niloofar-cosmetics.ir",
  },
  {
    title: "نیلوفر کازمتیکس | فروشگاه اینترنتی مراقبت پوست",
    url: "https://niloofar-cosmetics.ir",
    snippet:
      "فروش آنلاین محصولات آرایشی و مراقبت مو. قیمت به تومان. آدرس جردن تهران. تلفن ۰۲۱۸۸۰۰۳۳۴۴. ارسال به سراسر ایران.",
  },
  {
    title: "آریا بیوتی شاپ | Instagram",
    url: "https://www.instagram.com/aria_beauty_shop",
    snippet:
      "لوازم آرایشی اصل. رژ، ریمل، ضدآفتاب. ثبت سفارش در واتساپ. ارسال به سراسر ایران. آدرس: شریعتی، تهران.",
  },
  {
    title: "فروشگاه اینترنتی آریا بیوتی",
    url: "https://ariabeauty.ir",
    snippet:
      "فروشگاه اینترنتی لوازم آرایشی آریا بیوتی. آدرس خیابان شریعتی تهران. تلفن ۰۲۱۷۷۵۵۲۲۱۱. قیمت تومان. پشتیبانی واتساپ.",
  },
  {
    title: "Narin Beauty Istanbul",
    url: "https://www.instagram.com/narin_beauty_tr",
    snippet:
      "Persian speaking cosmetics shop in Istanbul, Turkey. Shipping from Turkey. Instagram boutique.",
  },
  {
    title: "Dubai Glow Cosmetics",
    url: "https://www.instagram.com/dubaiglow_cos",
    snippet: "UAE cosmetics brand in Dubai selling to Iranian customers. Shipping from Dubai.",
  },
  {
    title: "Sara personal makeup diary",
    url: "https://www.instagram.com/sara_makeup_diary",
    snippet: "دختر تهرانی که درباره لوازم آرایشی پست می‌گذارد. پیج شخصی.",
  },
  {
    title: "مرکز زیبایی نگین شیراز | Instagram",
    url: "https://www.instagram.com/negin_beauty_shiraz",
    snippet:
      "کلینیک زیبایی شیراز. نوبت‌دهی و مشاوره. خدمات پوست و مو. آدرس معالی‌آباد شیراز. تلفن ۰۷۱۳۲۲۴۴۵۵۶. سایت https://neginclinic.ir",
  },
  {
    title: "کلینیک زیبایی نگین",
    url: "https://neginclinic.ir",
    snippet:
      "مرکز تخصصی خدمات زیبایی در شیراز. رزرو نوبت آنلاین. تعرفه به تومان. آدرس معالی‌آباد، شیراز. تلفن ۰۷۱۳۲۲۴۴۵۵۶.",
  },
  {
    title: "مقاله درباره تفاوت کرم و سرم",
    url: "https://example-news.ir/article/cream-vs-serum",
    snippet: "مقاله آموزشی درباره تفاوت کرم و سرم پوست. خبرگزاری نمونه.",
  },
];

const CLOTHING: Fixture[] = [
  {
    title: "رخت‌نگار پوشاک تهران",
    url: "https://www.instagram.com/rakhtnegar_tehran",
    snippet:
      "فروشگاه لباس زنانه تهران. فروش آنلاین، سفارش دایرکت، ارسال ایران. تلفن ۰۹۱۹۱۱۱۲۲۲۳. سایت https://rakhtnegar.ir",
  },
  {
    title: "رخت‌نگار | فروشگاه اینترنتی پوشاک",
    url: "https://rakhtnegar.ir",
    snippet:
      "فروشگاه اینترنتی پوشاک تهران. آدرس انقلاب، تهران. تلفن ۰۲۱۸۸۰۰۱۱۲۲. قیمت به تومان. کاتالوگ سایز و رنگ.",
  },
  {
    title: "مزون ناز | Instagram",
    url: "https://www.instagram.com/maison_naz",
    snippet:
      "مزون لباس مجلسی مشهد. سایز و رنگ متنوع. سفارش از دایرکت. آدرس احمدآباد مشهد. تلفن ۰۵۱۳۳۳۲۲۱۱۰.",
  },
  {
    title: "فروشگاه اینترنتی مزون ناز",
    url: "https://maisonnaz.ir",
    snippet:
      "فروش آنلاین مانتو و پیراهن. ارسال به سراسر ایران. آدرس احمدآباد، مشهد. تلفن ۰۵۱۳۳۳۲۲۱۱۰. قیمت تومان.",
  },
];

const RESTAURANT: Fixture[] = [
  {
    title: "آش تهران | Instagram",
    url: "https://www.instagram.com/ashe_tehran",
    snippet:
      "رستوران تهران. آدرس خیابان ولیعصر تهران. تلفن ۰۲۱۸۸۷۷۶۶۵۵. رزرو واتساپ و سفارش آنلاین. سایت https://ashe.ir منو تومان.",
  },
  {
    title: "رستوران آش تهران",
    url: "https://ashe.ir",
    snippet:
      "رستوران ایرانی تهران. آدرس ولیعصر، تهران. تلفن ۰۲۱۸۸۷۷۶۶۵۵. سفارش آنلاین و رزرو. قیمت به تومان.",
  },
  {
    title: "دلیوری کباب‌سرای اصفهان",
    url: "https://www.instagram.com/kabab_saraye_esf",
    snippet:
      "سفارش آنلاین غذا و دلیوری در اصفهان. منو کباب. آدرس چهارباغ اصفهان. تلفن ۰۳۱۳۶۶۵۴۴۳۳.",
  },
];

const JEWELRY: Fixture[] = [
  {
    title: "زرنگار طلا و جواهر اصفهان",
    url: "https://www.instagram.com/zarnegar_esf",
    snippet:
      "طلافروشی اصفهان. آدرس میدان نقش جهان. تلفن ۰۳۱۳۲۲۱۱۰۰. سایت https://zarnegar.com سفارش واتساپ.",
  },
  {
    title: "Zarnegar Jewelry",
    url: "https://zarnegar.com",
    snippet:
      "طلا و جواهر ایرانی مبتنی بر اصفهان. آدرس نقش جهان، اصفهان. تلفن ۰۳۱۳۲۲۱۱۰۰. قیمت به تومان.",
  },
  {
    title: "گالری طلا پارسیس تهران",
    url: "https://www.instagram.com/parsiss_gold",
    snippet:
      "فروشگاه طلا در تهران. اجرت و قیمت روز. انگشتر و سرویس طلا. آدرس کریمخان تهران. تلفن ۰۲۱۸۸۳۳۴۴۵۵.",
  },
];

const FIXTURE_GROUPS: { match: RegExp; items: Fixture[] }[] = [
  { match: /آرایشی|آرایش|cosmetics|makeup|beauty|زیبایی|مراقبت/i, items: COSMETICS },
  { match: /لباس|پوشاک|مزون|clothing|fashion|مانتو/i, items: CLOTHING },
  { match: /رستوران|غذا|food|restaurant|کباب|دلیوری/i, items: RESTAURANT },
  { match: /جواهر|طلا|jewelry|gold|زر/i, items: JEWELRY },
];

/** Fixtures always returned by the mock (stable behaviour for tests/demos). */
const MOCK_CORE_FIXTURES = 5;

/** Deterministic hash → no randomness, identical input gives identical output. */
function hashQuery(query: string): number {
  let hash = 2166136261;
  for (let i = 0; i < query.length; i += 1) {
    hash ^= query.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export class MockSearchProvider implements SearchProvider {
  readonly name = "mock";
  readonly isMock = true;
  readonly capabilities: ProviderCapabilities = {
    siteOperator: true,
    negativeTerms: true,
    maxResultsPerQuery: 10,
  };

  async search(query: string): Promise<SearchResultItem[]> {
    const groups = FIXTURE_GROUPS.filter((group) => group.match.test(query));
    if (!groups.length) return [];
    const pool = groups.flatMap((group) => group.items);
    const size = Math.min(resultsPerQuery(this.capabilities.maxResultsPerQuery), pool.length);

    // The first CORE_FIXTURES are always returned (stable, testable behaviour);
    // the rest rotate deterministically per query so different queries surface
    // different candidates (saturation / diminishing returns stay realistic).
    const core = pool.slice(0, Math.min(MOCK_CORE_FIXTURES, size));
    const rest = pool.slice(MOCK_CORE_FIXTURES);
    const offset = rest.length ? hashQuery(query) % rest.length : 0;
    const rotated = rest.length
      ? Array.from({ length: Math.max(0, size - core.length) }, (_, index) => rest[(offset + index) % rest.length])
      : [];

    return [...core, ...rotated]
      .filter((item): item is Fixture => Boolean(item))
      .map((item) => ({ ...item, query, provider: this.name }));
  }
}

export function createSearchProvider(): SearchProvider {
  const requested = (process.env.SEARCH_PROVIDER ?? "").trim().toLowerCase();
  if (requested === "mock") return new MockSearchProvider();
  if (requested === "tavily") return new TavilySearchProvider();
  if (requested === "serper") return new SerperSearchProvider();
  if (requested === "brave") return new BraveSearchProvider();

  if (process.env.TAVILY_API_KEY) return new TavilySearchProvider();
  if (process.env.SERPER_API_KEY) return new SerperSearchProvider();
  if (process.env.BRAVE_API_KEY) return new BraveSearchProvider();

  throw new SearchProviderError(
    "SEARCH_PROVIDER_UNAVAILABLE",
    "No search provider configured. Set SEARCH_PROVIDER=mock for labeled mock data, or provide TAVILY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY.",
  );
}
