import type { Candidate } from "@/lib/search/discovery";
import type { SearchResultItem } from "@/types/lead";

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
  };
}
