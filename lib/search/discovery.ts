import type { Lead, SearchResultItem } from "@/types/lead";
import type { Candidate, DiscoverySourceType } from "@/types/search";
import { isSameLead } from "@/lib/leads/duplicate";
import { normalizeBusinessKey, normalizeUsername } from "@/lib/leads/normalize";
import { canonicalizeUrl, isSocialHost, matchKey, normalizeText } from "./normalize";
import { candidatePromiseScore, cheapSignals, type SignalContext } from "./signals";

export type { Candidate };
export type { DiscoverySourceType };

export type ExtractOptions = SignalContext & {
  /** Search round the results came from (traceability). */
  round?: number;
};

const INSTAGRAM_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/gi;
const WEBSITE_RE = /https?:\/\/[^\s)>"']+/gi;
const TELEGRAM_RE = /(?:t\.me\/|telegram\.me\/)([A-Za-z0-9_]{3,})/i;
const WHATSAPP_RE = /(?:wa\.me\/|whatsapp)[^\s]*/i;

const IG_BLOCKED_USERS = new Set([
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
  "tv",
  "highlights",
]);

const DIRECTORY_HINTS =
  /yellowpages|businesslist|directory|اصناف|lijara|shoplist|iranlist|بنگاه/;
const DIRECTORY_TEXT_HINTS = /آدرس|تماس|تلفن|دفتر|شعبه/;

/** Hosts that are content platforms, not businesses. */
const CONTENT_HOSTS = new Set([
  "wikipedia.org",
  "youtube.com",
  "youtu.be",
  "aparat.com",
  "namasha.com",
  "medium.com",
  "quora.com",
  "reddit.com",
  "pinterest.com",
]);

function blocklistOf(): Set<string> {
  return IG_BLOCKED_USERS;
}

export function isInstagramProfileUrl(raw: string | null | undefined): boolean {
  return canonicalizeUrl(raw)?.isInstagramProfile ?? false;
}

export function sourceTypeOf(
  result: Pick<SearchResultItem, "url" | "snippet" | "title">,
): DiscoverySourceType {
  const canonical = canonicalizeUrl(result.url);
  if (!canonical) return "public_search";
  if (canonical.isInstagramProfile) return "instagram_profile";
  const host = canonical.host;
  if (CONTENT_HOSTS.has(host)) return "public_search";
  if (isSocialHost(host)) return "public_search";
  if (DIRECTORY_HINTS.test(host)) return "business_directory";
  const text = `${result.title ?? ""} ${result.snippet ?? ""}`;
  if (DIRECTORY_HINTS.test(text) || (DIRECTORY_TEXT_HINTS.test(text) && !/فروش/.test(text))) {
    return "business_directory";
  }
  return "official_website";
}

/** Max usernames trusted from one result page (avoids directory-page explosion). */
const MAX_USERNAMES_PER_RESULT = 3;

function collectUsernames(result: SearchResultItem): string[] {
  const blob = `${result.title}\n${result.snippet}\n${result.url}`;
  const blocked = blocklistOf();
  const ordered: string[] = [];
  const push = (value: string | null) => {
    const username = normalizeUsername(value);
    if (!username || blocked.has(username)) return;
    if (!ordered.includes(username)) ordered.push(username);
  };

  // Prefer the username carried by the result URL itself (most reliable).
  const canonical = canonicalizeUrl(result.url);
  if (canonical?.isInstagramProfile) push(canonical.instagramUsername);
  for (const match of blob.matchAll(INSTAGRAM_RE)) push(match[1]);
  const handle = blob.match(/\(@([A-Za-z0-9._]{2,30})\)/);
  push(handle?.[1] ?? null);

  return ordered.slice(0, MAX_USERNAMES_PER_RESULT);
}

function collectWebsites(result: SearchResultItem): string[] {
  const blob = `${result.title}\n${result.snippet}\n${result.url}`;
  const found = (blob.match(WEBSITE_RE) ?? [])
    .map((url) => url.replace(/[.,;]+$/, ""))
    .map((url) => canonicalizeUrl(url))
    .filter((value): value is NonNullable<ReturnType<typeof canonicalizeUrl>> => Boolean(value))
    .filter((value) => !value.isInstagramProfile)
    .filter((value) => !isSocialHost(value.host))
    .filter((value) => !CONTENT_HOSTS.has(value.host))
    .map((value) => value.url);
  return [...new Set(found)];
}

function extractContacts(blob: string): { telegram: string | null; whatsapp: string | null } {
  const telegram =
    blob.match(TELEGRAM_RE)?.[0] ??
    blob.match(/(?:تلگرام|telegram)[:\s]+@?([A-Za-z0-9_]{3,})/i)?.[0] ??
    null;
  const whatsapp =
    blob.match(WHATSAPP_RE)?.[0] ?? (/واتساپ|whatsapp/i.test(blob) ? "whatsapp" : null);
  return { telegram: telegram ? normalizeText(telegram) : null, whatsapp };
}

function cleanBusinessName(title: string): string | null {
  const value = normalizeText(title)
    .replace(/\s*[|–—-]\s*(instagram|اینستاگرام).*$/i, "")
    .replace(/\s*[|–—-]\s*.*$/, "")
    .trim();
  return value.length > 1 && value.length < 80 ? value : null;
}

function emptyCandidate(identityKey: string, username: string | null): Candidate {
  return {
    username,
    instagramUrl: username ? `https://www.instagram.com/${username}` : null,
    businessName: null,
    bio: null,
    website: null,
    telegram: null,
    whatsapp: null,
    followers: null,
    evidence: [],
    sourceUrls: [],
    textBlob: "",
    results: [],
    identityKey,
    discoveryQueries: [],
    discoveryRounds: [],
    discoverySources: [],
    discoverySignals: [],
    promiseScore: 0,
  };
}

function mergeInto(target: Candidate, incoming: Candidate): Candidate {
  target.textBlob = `${target.textBlob}\n${incoming.textBlob}`.trim();
  target.results = [...target.results, ...incoming.results];
  target.sourceUrls = [...new Set([...(target.sourceUrls ?? []), ...(incoming.sourceUrls ?? [])])];
  target.discoveryQueries = [
    ...new Set([...(target.discoveryQueries ?? []), ...(incoming.discoveryQueries ?? [])]),
  ];
  target.discoveryRounds = [
    ...new Set([...(target.discoveryRounds ?? []), ...(incoming.discoveryRounds ?? [])]),
  ];
  target.discoverySources = [
    ...new Set([...(target.discoverySources ?? []), ...(incoming.discoverySources ?? [])]),
  ];
  target.businessName = target.businessName ?? incoming.businessName;
  target.website = target.website ?? incoming.website;
  target.username = target.username ?? incoming.username;
  target.instagramUrl = target.instagramUrl ?? incoming.instagramUrl;
  target.telegram = target.telegram ?? incoming.telegram;
  target.whatsapp = target.whatsapp ?? incoming.whatsapp;
  target.bio = target.bio ?? incoming.bio;
  target.businessType = target.businessType ?? incoming.businessType;
  return target;
}

/**
 * Business-level dedupe: two accounts that clearly belong to the same business
 * are merged, but only with meaningful evidence (shared website + same name,
 * or the same normalized Instagram username).
 */
export function shouldMergeCandidates(a: Candidate, b: Candidate): boolean {
  const userA = normalizeUsername(a.username ?? a.instagramUrl);
  const userB = normalizeUsername(b.username ?? b.instagramUrl);
  if (userA && userB && userA === userB) return true;

  if (a.website && b.website) {
    const canonicalA = canonicalizeUrl(a.website);
    const canonicalB = canonicalizeUrl(b.website);
    if (
      canonicalA &&
      canonicalB &&
      canonicalA.host === canonicalB.host &&
      !isSocialHost(canonicalA.host) &&
      !CONTENT_HOSTS.has(canonicalA.host)
    ) {
      const nameA = normalizeBusinessKey(a.businessName);
      const nameB = normalizeBusinessKey(b.businessName);
      if (nameA && nameB && nameA === nameB) return true;
    }
  }

  if (!a.username && !b.username && !a.website && !b.website) {
    const nameA = normalizeBusinessKey(a.businessName);
    const nameB = normalizeBusinessKey(b.businessName);
    const cityA = matchKey(a.city ?? "");
    const cityB = matchKey(b.city ?? "");
    if (nameA && nameB && nameA === nameB && cityA && cityA === cityB) return true;
  }

  return isSameLead(a as Partial<Lead>, b as Partial<Lead>);
}

/**
 * Extracts candidates from public search results.
 * Candidate identity preference: Instagram username → canonical website → URL.
 */
export function extractCandidates(
  results: SearchResultItem[],
  options: ExtractOptions = {},
): Candidate[] {
  const round = options.round ?? 1;
  const context: SignalContext = { category: options.category, city: options.city };
  const byKey = new Map<string, Candidate>();

  for (const result of results) {
    const canonical = canonicalizeUrl(result.url);
    if (!canonical) continue;

    const blob = normalizeText(`${result.title ?? ""}\n${result.snippet ?? ""}\n${result.url}`);
    const sourceType = sourceTypeOf(result);
    const usernames = collectUsernames(result);
    const websites = collectWebsites(result);
    const { telegram, whatsapp } = extractContacts(blob);

    const identityKeys = usernames.length
      ? usernames.map((username) => `ig:${username}`)
      : websites.length
        ? websites.slice(0, 1).map((website) => `web:${canonicalizeUrl(website)?.host ?? website}`)
        : [`url:${canonical.key}`];

    for (const identityKey of identityKeys) {
      const username = identityKey.startsWith("ig:") ? identityKey.slice(3) : null;
      const existing = byKey.get(identityKey);
      const candidate: Candidate = existing ?? emptyCandidate(identityKey, username);

      candidate.sourceUrls = [...new Set([...(candidate.sourceUrls ?? []), canonical.url])];
      candidate.textBlob = `${candidate.textBlob}\n${blob}`.trim();
      candidate.results = [...(candidate.results ?? []), result];
      if (result.query && !candidate.discoveryQueries.includes(result.query)) {
        candidate.discoveryQueries = [...candidate.discoveryQueries, result.query];
      }
      if (!candidate.discoveryRounds.includes(round)) {
        candidate.discoveryRounds = [...candidate.discoveryRounds, round];
      }
      if (!candidate.discoverySources.includes(sourceType)) {
        candidate.discoverySources = [...candidate.discoverySources, sourceType];
      }
      if (!candidate.businessName) candidate.businessName = cleanBusinessName(result.title ?? "");
      if (!candidate.website && websites.length) candidate.website = websites[0];
      if (!candidate.telegram && telegram) candidate.telegram = telegram;
      if (!candidate.whatsapp && whatsapp) candidate.whatsapp = whatsapp;
      if (!candidate.bio && result.snippet) candidate.bio = normalizeText(result.snippet);

      byKey.set(identityKey, candidate);
    }
  }

  const merged = mergeCandidates([...byKey.values()]);
  for (const candidate of merged) {
    const signals = cheapSignals(candidate, context);
    candidate.discoverySignals = [...signals.positive, ...signals.negative.map((n) => `-${n}`)];
    candidate.promiseScore = candidatePromiseScore(candidate, context);
  }
  return merged.sort((a, b) => b.promiseScore - a.promiseScore);
}

export function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const existing = merged.find((item) => shouldMergeCandidates(item, candidate));
    if (!existing) {
      merged.push(candidate);
      continue;
    }
    mergeInto(existing, candidate);
  }
  return merged;
}
