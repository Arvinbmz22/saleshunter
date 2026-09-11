import type { Lead, SearchResultItem } from "@/types/lead";
import { isSameLead } from "@/lib/leads/duplicate";
import {
  hostnameOf,
  normalizeInstagramUrl,
  normalizeUsername,
} from "@/lib/leads/normalize";

const INSTAGRAM_RE =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/gi;
const WEBSITE_RE = /https?:\/\/[^\s)]+/gi;
const TELEGRAM_RE = /(?:t\.me\/|telegram\.me\/)([A-Za-z0-9_]{3,})/i;
const WHATSAPP_RE = /(?:wa\.me\/|whatsapp)[^\s]*/i;
const BLOCKED_USERS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "share",
  "legal",
  "about",
  "directory",
  "popular",
  "instagram",
]);

export type Candidate = Partial<Lead> & {
  textBlob: string;
  results: SearchResultItem[];
};

export function extractCandidates(results: SearchResultItem[]): Candidate[] {
  const byKey = new Map<string, Candidate>();

  for (const result of results) {
    const blob = `${result.title}\n${result.snippet}\n${result.url}`;
    const usernames = collectUsernames(blob, result.url);

    const websites = (blob.match(WEBSITE_RE) ?? [])
      .map((url) => url.replace(/[.,]+$/, ""))
      .filter((url) => !/instagram\.com|facebook\.com|twitter\.com|youtube\.com|t\.me/i.test(url));

    const { telegram, whatsapp } = extractContacts(blob);

    const keys = usernames.size
      ? [...usernames]
      : websites.length
        ? websites.map((w) => `web:${hostnameOf(w) ?? w}`)
        : [`url:${result.url}`];

    for (const key of keys) {
      const existing = byKey.get(key);
      const username = key.startsWith("web:") || key.startsWith("url:")
        ? null
        : key;
      const next: Candidate = existing ?? {
        username,
        instagramUrl: normalizeInstagramUrl(username),
        businessName: result.title.replace(/\s*[|\-–].*$/, "").trim() || null,
        bio: result.snippet || null,
        website: websites[0] ?? (hostnameOf(result.url) && !/instagram\.com/i.test(result.url) ? result.url : null),
        telegram,
        whatsapp,
        followers: null,
        evidence: [],
        sourceUrls: [],
        textBlob: "",
        results: [],
      };
      next.sourceUrls = [...new Set([...(next.sourceUrls ?? []), result.url])];
      next.textBlob = `${next.textBlob}\n${blob}`.trim();
      next.results = [...next.results, result];
      if (!next.website && websites[0]) next.website = websites[0];
      byKey.set(key, next);
    }
  }

  return mergeCandidates([...byKey.values()]);
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const existing = merged.find((item) => isSameLead(item, candidate));
    if (!existing) {
      merged.push(candidate);
      continue;
    }
    existing.textBlob = `${existing.textBlob}\n${candidate.textBlob}`.trim();
    existing.sourceUrls = [...new Set([...(existing.sourceUrls ?? []), ...(candidate.sourceUrls ?? [])])];
    existing.results = [...existing.results, ...candidate.results];
    existing.website = existing.website ?? candidate.website;
    existing.username = existing.username ?? candidate.username;
    existing.instagramUrl = existing.instagramUrl ?? candidate.instagramUrl;
    existing.telegram = existing.telegram ?? candidate.telegram;
    existing.whatsapp = existing.whatsapp ?? candidate.whatsapp;
  }
  return merged;
}

function collectUsernames(blob: string, url: string): Set<string> {
  const usernames = new Set<string>();
  for (const match of blob.matchAll(INSTAGRAM_RE)) {
    const username = normalizeUsername(match[1]);
    if (username && !BLOCKED_USERS.has(username)) usernames.add(username);
  }
  if (/instagram\.com/i.test(url)) {
    const username = normalizeUsername(url);
    if (username && !BLOCKED_USERS.has(username)) usernames.add(username);
  }
  const handle = blob.match(/\(@([A-Za-z0-9._]{2,30})\)/);
  const fromHandle = normalizeUsername(handle?.[1] ?? null);
  if (fromHandle && !BLOCKED_USERS.has(fromHandle)) usernames.add(fromHandle);
  return usernames;
}

function extractContacts(blob: string): { telegram: string | null; whatsapp: string | null } {
  const telegram =
    blob.match(TELEGRAM_RE)?.[0] ??
    blob.match(/تلگرام[:\s]+@?([A-Za-z0-9_]{3,})/i)?.[0] ??
    null;
  const whatsapp = blob.match(WHATSAPP_RE)?.[0] ?? (/واتساپ/.test(blob) ? "whatsapp" : null);
  return { telegram, whatsapp };
}
