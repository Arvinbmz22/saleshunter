import { z } from "zod";

export const searchInputSchema = z.object({
  category: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(40),
  city: z.string().trim().max(40).optional(),
  limit: z.number().int().min(1).max(50),
});

const buckets = new Map<string, { count: number; ts: number }>();

export function rateLimit(key: string, max = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now - current.ts > windowMs) {
    buckets.set(key, { count: 1, ts: now });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

export function publicError(message: string): string {
  return message.replace(/sk-[a-zA-Z0-9]+/g, "[redacted]").slice(0, 300);
}
