import type { Lead, SearchResultItem } from "@/types/lead";

/**
 * Search-engine domain types.
 *
 * The discovery engine only finds candidates from public sources.
 * Verification decides whether a candidate is real / relevant / Iranian.
 * See docs/SEARCH_ENGINE.md for the full architecture.
 */

export type DiscoverySourceType =
  | "instagram_profile"
  | "official_website"
  | "business_directory"
  | "public_search";

/** A candidate business discovered from public search results. */
export type Candidate = Partial<Lead> & {
  /** All public text gathered for this candidate (titles + snippets + urls). */
  textBlob: string;
  /** Raw search results that produced this candidate (traceability). */
  results: SearchResultItem[];
  /** Canonical identity: `ig:<user>` | `web:<host>` | `url:<key>`. */
  identityKey: string;
  /** Queries that surfaced this candidate. */
  discoveryQueries: string[];
  /** Search rounds in which this candidate was seen. */
  discoveryRounds: number[];
  /** Independent source types (source diversity). */
  discoverySources: DiscoverySourceType[];
  /** Cheap discovery signals extracted from snippets (positive/negative). */
  discoverySignals: string[];
  /** Cheap promise score 0-100, used only to ORDER candidates. */
  promiseScore: number;
};

export type TermRelation =
  | "exact"
  | "synonym"
  | "commercial"
  | "subcategory"
  | "local"
  | "product"
  | "service";

export type SearchTerm = {
  term: string;
  relation: TermRelation;
  confidence: number;
};

export type QueryFamily =
  | "exact_category"
  | "commercial_intent"
  | "business_type"
  | "contact_channel"
  | "product_specific"
  | "website"
  | "domain"
  | "directory"
  | "location_focus"
  | "follow_up"
  | "adaptive";

export type SearchQuery = {
  query: string;
  family: QueryFamily;
  /** Round this query is scheduled for (1-based). */
  round: number;
  /** Category / product term the query is built from. */
  term: string;
  /** Location string used, if any. */
  location: string | null;
  mode: "exploration" | "exploitation";
  expectedValue: number;
  commercialIntent: number;
  locationSpecificity: number;
  categoryRelevance: number;
  diversityScore: number;
  /** 0-100, computed by rankQueries(). */
  priority: number;
};

export type QueryStatus = "ok" | "empty" | "error" | "timeout" | "rate_limited";

export type QueryStats = {
  query: string;
  family: QueryFamily;
  round: number;
  executedAt: string;
  status: QueryStatus;
  error?: string;
  resultCount: number;
  newResults: number;
  duplicateResults: number;
  newCandidateCount: number;
  duplicateCandidateCount: number;
  historicalDuplicateCount: number;
  businessishCount: number;
  rejectedEarlyCount: number;
  estimatedValue: number;
};

export type FamilyStats = {
  family: QueryFamily;
  executed: number;
  results: number;
  newCandidates: number;
  businessish: number;
  /** newCandidates per executed query. */
  yieldPerQuery: number;
  /** 0-100 relative value used for adaptive budget allocation. */
  value: number;
};

export type FailurePattern =
  | "TOO_MANY_PERSONAL"
  | "TOO_MANY_FOREIGN"
  | "TOO_MANY_DUPLICATES"
  | "TOO_MANY_NEWS"
  | "TOO_MANY_FAN_PAGES"
  | "TOO_FEW_BUSINESSES"
  | "TOO_FEW_IRANIAN_RESULTS"
  | "TOO_FEW_CITY_MATCHES"
  | "TOO_FEW_COMMERCIAL_RESULTS"
  | "LOW_CATEGORY_RELEVANCE";

export type StopReason =
  | "ENOUGH_QUALIFIED_LEADS"
  | "SEARCH_BUDGET_EXHAUSTED"
  | "DIMINISHING_RETURNS"
  | "NO_MORE_USEFUL_RESULTS"
  | "MAX_ROUNDS"
  | "TIME_BUDGET_EXHAUSTED"
  | "PROVIDER_LIMIT"
  | "PROVIDER_FAILURE"
  | "NO_RESULTS";

export type CategoryDifficulty = "EASY" | "MEDIUM" | "HARD" | "VERY_HARD";

export type SearchBudget = {
  maxQueries: number;
  maxResultsPerQuery: number;
  maxCandidates: number;
  maxRounds: number;
  maxSearchTimeMs: number;
};

export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  maxQueries: 80,
  maxResultsPerQuery: 10,
  maxCandidates: 300,
  maxRounds: 7,
  maxSearchTimeMs: 120_000,
};

/**
 * Rejected-candidate breakdown reported back by the verification stage.
 * Used only to adapt the search strategy — never to fabricate results.
 */
export type RejectedBreakdown = {
  personal: number;
  fanOrNews: number;
  foreign: number;
  irrelevant: number;
  duplicates: number;
  iranRejected: number;
  other: number;
};

export type SearchState = {
  request: { category: string; country: string; city: string | null; limit: number };
  currentRound: number;
  maxRounds: number;
  queriesGenerated: number;
  queriesExecuted: number;
  queriesFailed: number;
  rawResults: number;
  uniqueResults: number;
  candidates: number;
  historicalDuplicates: number;
  sessionDuplicates: number;
  rejectedEarly: number;
  qualifiedCount: number;
  difficulty: CategoryDifficulty;
  targetCandidates: number;
  queryStats: QueryStats[];
  familyStats: FamilyStats[];
  failurePatterns: FailurePattern[];
  providerErrors: string[];
  partialSearch: boolean;
  stoppedReason: StopReason | null;
};

export type SearchDiagnostics = {
  provider: string;
  mockMode: boolean;
  queriesGenerated: number;
  queriesExecuted: number;
  queriesFailed: number;
  rawResults: number;
  uniqueResults: number;
  candidates: number;
  historicalDuplicates: number;
  sessionDuplicates: number;
  rejectedEarly: number;
  rounds: number;
  maxRounds: number;
  stopReason: StopReason | null;
  partialSearch: boolean;
  difficulty: CategoryDifficulty;
  familyStats: FamilyStats[];
  failurePatterns: FailurePattern[];
  providerErrors: string[];
};

export type EngineProgressEvent =
  | {
      kind: "round_start";
      round: number;
      maxRounds: number;
      planned: number;
      detail: string;
    }
  | {
      kind: "query";
      query: string;
      family: QueryFamily;
      round: number;
      executed: number;
      budget: number;
      status: QueryStatus;
      results: number;
    }
  | {
      kind: "round_done";
      round: number;
      candidates: number;
      newCandidates: number;
      detail: string;
      stopReason: StopReason | null;
    };

export type RoundOutcome = {
  round: number;
  queriesExecuted: number;
  newCandidates: number;
  totalCandidates: number;
  stopReason: StopReason | null;
  stopped: boolean;
};

/** Provider capability flags so core search logic stays provider-agnostic. */
export type ProviderCapabilities = {
  siteOperator: boolean;
  negativeTerms: boolean;
  maxResultsPerQuery: number;
};
