import type { SearchResultItem } from "@/types/lead";
import type { QueryStats, SearchQuery } from "@/types/search";
import { canonicalizeUrl } from "./normalize";
import { SearchProviderError, type SearchProvider } from "./provider";

export type QueryExecution = {
  stats: QueryStats;
  results: SearchResultItem[];
};

/** Drops malformed / unsupported URLs and de-duplicates by canonical URL key. */
export function dedupeSearchResults(
  items: SearchResultItem[],
  seen?: Set<string>,
): { results: SearchResultItem[]; duplicates: number } {
  const local = seen ?? new Set<string>();
  const out: SearchResultItem[] = [];
  let duplicates = 0;
  for (const item of items) {
    const canonical = canonicalizeUrl(item.url);
    if (!canonical) continue;
    if (local.has(canonical.key)) {
      duplicates += 1;
      continue;
    }
    local.add(canonical.key);
    out.push({ ...item, url: canonical.url });
  }
  return { results: out, duplicates };
}

function statusOf(error: unknown): { status: QueryStats["status"]; message: string } {
  if (error instanceof SearchProviderError) {
    const map: Record<string, QueryStats["status"]> = {
      PROVIDER_TIMEOUT: "timeout",
      PROVIDER_RATE_LIMIT: "rate_limited",
      PROVIDER_NETWORK: "error",
      PROVIDER_HTTP: "error",
      PROVIDER_MALFORMED: "error",
      SEARCH_PROVIDER_UNAVAILABLE: "error",
    };
    return { status: map[error.code] ?? "error", message: error.message };
  }
  return { status: "error", message: error instanceof Error ? error.message : "unknown error" };
}

/**
 * Executes a single query against the provider.
 * A failing query never crashes the pipeline — it is recorded and the search
 * continues with whatever the other queries returned (partial results).
 */
export async function executeQuery(
  provider: SearchProvider,
  query: SearchQuery,
  ctx: { seenResultKeys: Set<string>; maxResults: number; now: () => Date },
): Promise<QueryExecution> {
  const base: QueryStats = {
    query: query.query,
    family: query.family,
    round: query.round,
    executedAt: ctx.now().toISOString(),
    status: "ok",
    resultCount: 0,
    newResults: 0,
    duplicateResults: 0,
    newCandidateCount: 0,
    duplicateCandidateCount: 0,
    historicalDuplicateCount: 0,
    businessishCount: 0,
    rejectedEarlyCount: 0,
    estimatedValue: 0,
  };

  let raw: SearchResultItem[] = [];
  try {
    raw = await provider.search(query.query);
    if (!Array.isArray(raw)) {
      throw new SearchProviderError("PROVIDER_MALFORMED", "Search provider returned no result list");
    }
  } catch (error) {
    const { status, message } = statusOf(error);
    return { stats: { ...base, status, error: message }, results: [] };
  }

  const capped = raw.slice(0, ctx.maxResults);
  const { results, duplicates } = dedupeSearchResults(capped, ctx.seenResultKeys);

  return {
    stats: {
      ...base,
      status: results.length ? "ok" : "empty",
      resultCount: raw.length,
      newResults: results.length,
      duplicateResults: duplicates,
    },
    results,
  };
}
