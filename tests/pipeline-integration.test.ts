import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "adminex-leads-"));
process.env.LEADS_DATA_DIR = dataDir;
process.env.SEARCH_PROVIDER = "mock";
process.env.AI_PROVIDER = "mock";
delete process.env.OPENAI_API_KEY;
delete process.env.TAVILY_API_KEY;
delete process.env.SERPER_API_KEY;
delete process.env.BRAVE_API_KEY;

const { runPipeline } = await import("@/lib/pipeline/run");
const { SearchProviderError } = await import("@/lib/search/provider");
const { loadLeads } = await import("@/lib/leads/storage");

const REQUEST = { category: "لوازم آرایشی", country: "ایران", city: "تهران", limit: 5 };

function collect() {
  const events: { stage: string; detail?: string }[] = [];
  const onProgress = async (event: { stage: string; detail?: string }) => {
    events.push({ stage: event.stage, detail: event.detail });
  };
  return { events, onProgress };
}

describe("pipeline integration (mock provider)", () => {
  beforeAll(() => {
    process.env.SEARCH_PROVIDER = "mock";
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("discovers, verifies, ranks and stores leads", async () => {
    const { events, onProgress } = collect();
    const result = await runPipeline(REQUEST, onProgress);

    expect(result.leads.length).toBeGreaterThan(0);
    expect(result.leads.length).toBeLessThanOrEqual(REQUEST.limit);
    expect(result.stats.accepted).toBe(result.leads.length);
    expect(result.stats.mockMode).toBe(true);

    for (const lead of result.leads) {
      expect(lead.score).toBeGreaterThanOrEqual(0);
      expect(lead.score).toBeLessThanOrEqual(100);
      expect(["HOT", "HIGH", "MEDIUM", "LOW"]).toContain(lead.tier);
      expect(lead.sourceUrls.length).toBeGreaterThan(0);
      expect(lead.iranVerificationStatus).not.toBe("NOT_IRAN");
      expect(lead.reason.length).toBeGreaterThan(0);
    }

    const usernames = result.leads.map((lead) => lead.username).filter(Boolean);
    expect(new Set(usernames).size).toBe(usernames.length);

    // Progress is real work, not fake stages.
    expect(events.map((event) => event.stage)).toContain("public_search");
    expect(events.map((event) => event.stage)).toContain("finalize");
  });

  it("reports full search diagnostics", async () => {
    const { onProgress } = collect();
    const result = await runPipeline({ ...REQUEST, limit: 3 }, onProgress);
    const diagnostics = result.stats.search;
    expect(diagnostics).toBeDefined();
    expect(diagnostics!.queriesExecuted).toBeGreaterThan(0);
    expect(diagnostics!.rounds).toBeGreaterThan(0);
    expect(diagnostics!.provider).toBe("mock");
    expect(typeof diagnostics!.stopReason).toBe("string");
    expect(diagnostics!.candidates).toBeGreaterThanOrEqual(result.leads.length);
  });

  it("does not return previously discovered leads again", async () => {
    const stored = await loadLeads();
    expect(stored.length).toBeGreaterThan(0);

    const { onProgress } = collect();
    const second = await runPipeline({ ...REQUEST, limit: 20 }, onProgress);
    const storedUsernames = new Set(stored.map((lead) => lead.username));
    for (const lead of second.leads) {
      if (lead.username) expect(storedUsernames.has(lead.username)).toBe(false);
    }
    expect(second.stats.search!.historicalDuplicates).toBeGreaterThan(0);
  });

  it("fails transparently when no search provider is configured", async () => {
    const previous = process.env.SEARCH_PROVIDER;
    delete process.env.SEARCH_PROVIDER;
    const { onProgress } = collect();
    await expect(runPipeline({ ...REQUEST, limit: 1 }, onProgress)).rejects.toBeInstanceOf(
      SearchProviderError,
    );
    await expect(runPipeline({ ...REQUEST, limit: 1 }, onProgress)).rejects.toMatchObject({
      code: "SEARCH_PROVIDER_UNAVAILABLE",
    });
    if (previous) process.env.SEARCH_PROVIDER = previous;
  });
});
