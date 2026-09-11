import type { SearchResultItem } from "@/types/lead";
import type { SearchProvider } from "./provider";

export function dedupeSearchResults(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const item of items) {
    const key = item.url.split("?")[0]?.replace(/\/+$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function executeQueries(
  provider: SearchProvider,
  queries: string[],
  opts: {
    budget: number;
    targetPool: number;
    onQuery?: (query: string, used: number, total: number) => void | Promise<void>;
  },
): Promise<{ results: SearchResultItem[]; used: number }> {
  const selected = queries.slice(0, opts.budget);
  const concurrency = provider.isMock ? 6 : 3;
  const collected: SearchResultItem[] = [];
  let used = 0;
  let errors = 0;
  let lastError: unknown;

  for (let i = 0; i < selected.length; i += concurrency) {
    if (collected.length >= opts.targetPool) break;
    const chunk = selected.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map((query) => provider.search(query)));
    for (let j = 0; j < settled.length; j++) {
      used += 1;
      const query = chunk[j] ?? "";
      const item = settled[j];
      if (item?.status === "fulfilled") {
        collected.push(...item.value);
      } else {
        errors += 1;
        lastError = item?.status === "rejected" ? item.reason : lastError;
      }
      await opts.onQuery?.(query, used, selected.length);
    }
  }

  if (!collected.length && errors) {
    throw lastError instanceof Error ? lastError : new Error("Search provider failed");
  }

  return { results: dedupeSearchResults(collected), used };
}
