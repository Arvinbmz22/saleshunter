import { afterEach, describe, expect, it } from "vitest";
import { createSearchProvider } from "@/lib/search/provider";

describe("search provider", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("fails transparently when unconfigured", () => {
    delete process.env.SEARCH_PROVIDER;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.BRAVE_API_KEY;
    expect(() => createSearchProvider()).toThrow(/No search provider configured/);
  });

  it("mock is clearly mock", () => {
    process.env.SEARCH_PROVIDER = "mock";
    const p = createSearchProvider();
    expect(p.isMock).toBe(true);
    expect(p.name).toBe("mock");
  });
});
