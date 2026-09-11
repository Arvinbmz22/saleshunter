import { z } from "zod";
import type { Candidate } from "@/lib/search/discovery";

export const aiLeadSchema = z.object({
  businessName: z.string().nullable(),
  businessType: z.string().nullable(),
  city: z.string().nullable(),
  reasons: z.array(z.string()).max(12),
  warnings: z.array(z.string()).max(12),
  shopBotFit: z.number().min(0).max(100),
  credibility: z.number().min(0).max(100),
  inventedClaims: z.array(z.string()).default([]),
});

export type AILeadAnalysis = z.infer<typeof aiLeadSchema>;

export interface AIProvider {
  readonly name: string;
  readonly isMock: boolean;
  analyzeLead(candidate: Candidate, evidenceSummary: string): Promise<AILeadAnalysis | null>;
  scoreLead(candidate: Candidate): Promise<number | null>;
}

class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly isMock = true;
  async analyzeLead(candidate: Candidate): Promise<AILeadAnalysis | null> {
    return {
      businessName: candidate.businessName ?? null,
      businessType: "retail",
      city: null,
      reasons: [],
      warnings: [],
      shopBotFit: 0,
      credibility: 0,
      inventedClaims: [],
    };
  }
  async scoreLead(): Promise<number | null> {
    return null;
  }
}

class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai";
  readonly isMock = false;

  async analyzeLead(candidate: Candidate, evidenceSummary: string): Promise<AILeadAnalysis | null> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return null;
    const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You analyze PUBLIC business evidence only. Never invent contacts, followers, locations, or evidence. Return strict JSON matching the schema. If unknown, use null/empty.",
            },
            {
              role: "user",
              content: JSON.stringify({
                schema: {
                  businessName: "string|null",
                  businessType: "string|null",
                  city: "string|null",
                  reasons: "string[]",
                  warnings: "string[]",
                  shopBotFit: "0-100",
                  credibility: "0-100",
                  inventedClaims: "string[]",
                },
                evidenceSummary,
                candidate: {
                  username: candidate.username,
                  website: candidate.website,
                  text: (candidate.textBlob ?? "").slice(0, 4000),
                },
              }),
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      return parseAIResponse(content);
    } catch {
      return null;
    }
  }

  async scoreLead(): Promise<number | null> {
    return null;
  }
}

export function parseAIResponse(raw: string): AILeadAnalysis | null {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = aiLeadSchema.safeParse(json);
    if (!parsed.success) return null;
    if (parsed.data.inventedClaims.length) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function createAIProvider(): AIProvider {
  const requested = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (requested === "mock") return new MockAIProvider();
  if (process.env.OPENAI_API_KEY && requested !== "off") {
    return new OpenAICompatibleProvider();
  }
  return new MockAIProvider();
}
