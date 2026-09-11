import type { Lead } from "@/types/lead";
import { hostnameOf, normalizeBusinessKey, normalizeUsername } from "./normalize";

export function isSameLead(a: Partial<Lead>, b: Partial<Lead>): boolean {
  const userA = normalizeUsername(a.username ?? a.instagramUrl);
  const userB = normalizeUsername(b.username ?? b.instagramUrl);
  if (userA && userB && userA === userB) return true;

  const hostA = hostnameOf(a.website);
  const hostB = hostnameOf(b.website);
  if (hostA && hostB && hostA === hostB && hostA !== "instagram.com") return true;

  const nameA = normalizeBusinessKey(a.businessName);
  const nameB = normalizeBusinessKey(b.businessName);
  const cityA = (a.city ?? "").toLowerCase().trim();
  const cityB = (b.city ?? "").toLowerCase().trim();
  if (nameA && nameB && nameA === nameB && cityA && cityA === cityB) return true;

  return false;
}

export function isDuplicate(candidate: Partial<Lead>, existing: Partial<Lead>[]): boolean {
  return existing.some((lead) => isSameLead(candidate, lead));
}
