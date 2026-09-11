import type { SearchResultItem } from "@/types/lead";
import type { Candidate } from "@/lib/search/discovery";

export function candidate(partial: Partial<Candidate> & { textBlob: string }): Candidate {
  const results: SearchResultItem[] = partial.results ?? [
    {
      title: partial.businessName ?? "x",
      url: partial.instagramUrl ?? partial.website ?? "https://example.com",
      snippet: partial.textBlob,
      query: "t",
      provider: "test",
    },
  ];
  return {
    username: partial.username ?? null,
    instagramUrl: partial.instagramUrl ?? null,
    businessName: partial.businessName ?? null,
    website: partial.website ?? null,
    telegram: partial.telegram ?? null,
    whatsapp: partial.whatsapp ?? null,
    sourceUrls: partial.sourceUrls ?? results.map((r) => r.url),
    textBlob: partial.textBlob,
    results,
    identityKey: partial.identityKey ?? `ig:${partial.username ?? Math.random().toString(36).slice(2)}`,
    discoveryQueries: partial.discoveryQueries ?? ["t"],
    discoveryRounds: partial.discoveryRounds ?? [1],
    discoverySources: partial.discoverySources ?? ["public_search"],
    discoverySignals: partial.discoverySignals ?? [],
    promiseScore: partial.promiseScore ?? 50,
  };
}

export function result(item: Partial<SearchResultItem> & { url: string }): SearchResultItem {
  return {
    title: item.title ?? "",
    snippet: item.snippet ?? "",
    query: item.query ?? "q",
    provider: item.provider ?? "test",
    url: item.url,
  };
}

/** Deterministic fake provider for engine tests (no network, no randomness). */
export function fakeProvider(
  handler: (query: string) => SearchResultItem[] | Promise<SearchResultItem[]>,
  options: { name?: string; isMock?: boolean; failWith?: Error } = {},
) {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      name: options.name ?? "fake",
      isMock: options.isMock ?? false,
      capabilities: { siteOperator: true, negativeTerms: true, maxResultsPerQuery: 10 },
      async search(query: string): Promise<SearchResultItem[]> {
        calls.push(query);
        if (options.failWith) throw options.failWith;
        return handler(query);
      },
    },
  };
}
