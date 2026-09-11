import type { EvidenceItem } from "@/types/lead";
import { sourceIdFor } from "@/lib/leads/normalize";

export function makeEvidence(
  type: string,
  signal: string,
  sourceUrl: string | null,
  strength: EvidenceItem["strength"],
): EvidenceItem {
  return {
    type,
    signal,
    sourceUrl,
    sourceId: sourceIdFor(sourceUrl),
    strength,
  };
}

export function independentSourceCount(evidence: EvidenceItem[]): number {
  const ids = new Set(evidence.filter((e) => e.strength !== "weak").map((e) => e.sourceId));
  return ids.size;
}

export function independentSignals(evidence: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const item of evidence) {
    const key = `${item.sourceId}:${item.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
