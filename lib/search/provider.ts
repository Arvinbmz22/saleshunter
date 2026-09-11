import type { SearchResultItem } from "@/types/lead";

export interface SearchProvider {
  readonly name: string;
  readonly isMock: boolean;
  search(query: string): Promise<SearchResultItem[]>;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  readonly isMock = false;

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("TAVILY_API_KEY");
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 10,
        search_depth: "basic",
      }),
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed (${response.status})`);
    }
    const data = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (data.results ?? []).map((item) => ({
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

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("SERPER_API_KEY");
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
      },
      body: JSON.stringify({ q: query, num: 8 }),
    });
    if (!response.ok) {
      throw new Error(`Serper search failed (${response.status})`);
    }
    const data = (await response.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };
    return (data.organic ?? []).map((item) => ({
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

  async search(query: string): Promise<SearchResultItem[]> {
    const key = requireEnv("BRAVE_API_KEY");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "8");
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
    });
    if (!response.ok) {
      throw new Error(`Brave search failed (${response.status})`);
    }
    const data = (await response.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (data.web?.results ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.description ?? "",
      query,
      provider: this.name,
    }));
  }
}

const MOCK_FIXTURES: Record<string, SearchResultItem[]> = {
  cosmetics: [
    {
      title: "گل‌بوته آرایشی تهران | Instagram",
      url: "https://www.instagram.com/golboteh_beauty",
      snippet:
        "فروشگاه لوازم آرایشی تهران. ارسال به سراسر ایران. قیمت به تومان. سفارش از دایرکت و واتساپ ۰۹۱۲۳۴۵۶۷۸۹. آدرس: ولیعصر، تهران. سایت: https://golboteh.ir",
      query: "mock",
      provider: "mock",
    },
    {
      title: "گل‌بوته | فروشگاه اینترنتی آرایشی",
      url: "https://golboteh.ir",
      snippet:
        "فروشگاه اینترنتی لوازم آرایشی ایرانی. آدرس: خیابان ولیعصر، تهران. تلفن: ۰۲۱۸۸۷۷۶۶۵۵. پرداخت ریالی و ارسال به سراسر ایران.",
      query: "mock",
      provider: "mock",
    },
    {
      title: "Narin Beauty Istanbul",
      url: "https://www.instagram.com/narin_beauty_tr",
      snippet:
        "Persian speaking cosmetics shop in Istanbul, Turkey. Shipping from Turkey. Instagram boutique.",
      query: "mock",
      provider: "mock",
    },
    {
      title: "Dubai Glow Cosmetics",
      url: "https://www.instagram.com/dubaiglow_cos",
      snippet:
        "UAE cosmetics brand in Dubai selling to Iranian customers. Shipping from Dubai.",
      query: "mock",
      provider: "mock",
    },
    {
      title: "Sara personal makeup diary",
      url: "https://www.instagram.com/sara_makeup_diary",
      snippet: "دختر تهرانی که درباره لوازم آرایشی پست می‌گذارد. پیج شخصی.",
      query: "mock",
      provider: "mock",
    },
  ],
};

export class MockSearchProvider implements SearchProvider {
  readonly name = "mock";
  readonly isMock = true;

  async search(query: string): Promise<SearchResultItem[]> {
    const lower = query.toLowerCase();
    const extra: SearchResultItem[] = [];
    const cosmeticsHit = /آرایشی|cosmetics|makeup|beauty|لوازم آرایش/.test(lower);
    if (cosmeticsHit) extra.push(...MOCK_FIXTURES.cosmetics);
    if (/لباس|clothing|پوشاک/.test(lower)) {
      extra.push(
        {
          title: "رخت‌نگار پوشاک تهران",
          url: "https://www.instagram.com/rakhtnegar_tehran",
          snippet:
            "فروشگاه لباس زنانه تهران. فروش آنلاین، سفارش دایرکت، ارسال ایران. تلفن ۰۹۱۹۱۱۱۲۲۲۳. سایت https://rakhtnegar.ir",
          query,
          provider: this.name,
        },
        {
          title: "رخت‌نگار | فروشگاه اینترنتی پوشاک",
          url: "https://rakhtnegar.ir",
          snippet:
            "فروشگاه اینترنتی پوشاک تهران. آدرس انقلاب، تهران. تلفن ۰۲۱۸۸۰۰۱۱۲۲. قیمت به تومان. کاتالوگ سایز و رنگ.",
          query,
          provider: this.name,
        },
      );
    }
    if (/رستوران|غذا|food|restaurant/.test(lower)) {
      extra.push(
        {
          title: "آش تهران | Instagram",
          url: "https://www.instagram.com/ashe_tehran",
          snippet:
            "رستوران تهران. آدرس خیابان ولیعصر تهران. تلفن ۰۲۱۸۸۷۷۶۶۵۵. رزرو واتساپ و سفارش آنلاین. سایت https://ashe.ir منو تومان.",
          query,
          provider: this.name,
        },
        {
          title: "رستوران آش تهران",
          url: "https://ashe.ir",
          snippet:
            "رستوران ایرانی تهران. آدرس ولیعصر، تهران. تلفن ۰۲۱۸۸۷۷۶۶۵۵. سفارش آنلاین و رزرو. قیمت به تومان.",
          query,
          provider: this.name,
        },
      );
    }
    if (/جواهر|jewelry|طلا/.test(lower)) {
      extra.push(
        {
          title: "زرنگار طلا و جواهر اصفهان",
          url: "https://www.instagram.com/zarnegar_esf",
          snippet:
            "طلافروشی اصفهان. آدرس میدان نقش جهان. تلفن ۰۳۱۳۲۲۱۱۰۰. سایت https://zarnegar.com سفارش واتساپ.",
          query,
          provider: this.name,
        },
        {
          title: "Zarnegar Jewelry",
          url: "https://zarnegar.com",
          snippet:
            "طلا و جواهر ایرانی مبتنی در اصفهان. آدرس نقش جهان، اصفهان. تلفن ۰۳۱۳۲۲۱۱۰۰. قیمت به تومان.",
          query,
          provider: this.name,
        },
      );
    }
    return extra.map((item) => ({ ...item, query }));
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

  throw new Error(
    "No search provider configured. Set SEARCH_PROVIDER=mock for labeled mock data, or provide TAVILY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY.",
  );
}
