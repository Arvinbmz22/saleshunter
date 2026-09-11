import type { Lead, SearchRequest, SearchResultItem } from "@/types/lead";
import type {
  Candidate,
  CategoryDifficulty,
  EngineProgressEvent,
  FailurePattern,
  FamilyStats,
  ProviderCapabilities,
  QueryFamily,
  QueryStats,
  RejectedBreakdown,
  RoundOutcome,
  SearchBudget,
  SearchDiagnostics,
  SearchQuery,
  SearchState,
  StopReason,
} from "@/types/search";
import { DEFAULT_SEARCH_BUDGET } from "@/types/search";
import { normalizeUsername } from "@/lib/leads/normalize";
import { extractCandidates } from "./discovery";
import { executeQuery } from "./execute";
import { canonicalizeUrl, matchKey, normalizeRequest } from "./normalize";
import {
  ADAPTIVE_ROUND,
  adaptiveQueryPlan,
  followUpQueries,
  planRounds,
  type PlanOptions,
} from "./queryPlan";
import type { SearchProvider } from "./provider";
import { cheapSignals, earlyReject, type EarlyRejectReason } from "./signals";

export type EngineOptions = {
  request: SearchRequest;
  provider: SearchProvider;
  /** Previously stored leads — used for historical dedupe + saturation. */
  historical: Lead[];
  budget?: Partial<SearchBudget>;
  onProgress?: (event: EngineProgressEvent) => void | Promise<void>;
  now?: () => number;
};

/** Reads an optional integer env var; unset/invalid ⇒ undefined (use defaults). */
function envInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function resolveBudget(
  limit: number,
  overrides: Partial<SearchBudget> = {},
): SearchBudget {
  return {
    maxQueries: clampInt(
      overrides.maxQueries ?? envInt("SEARCH_BUDGET") ?? DEFAULT_SEARCH_BUDGET.maxQueries,
      5,
      200,
    ),
    maxResultsPerQuery: clampInt(
      overrides.maxResultsPerQuery ?? envInt("SEARCH_RESULTS_PER_QUERY") ?? DEFAULT_SEARCH_BUDGET.maxResultsPerQuery,
      3,
      20,
    ),
    maxCandidates: clampInt(
      overrides.maxCandidates ?? envInt("SEARCH_MAX_CANDIDATES") ?? Math.max(120, limit * 15),
      30,
      800,
    ),
    maxRounds: clampInt(
      overrides.maxRounds ?? envInt("SEARCH_MAX_ROUNDS") ?? DEFAULT_SEARCH_BUDGET.maxRounds,
      1,
      8,
    ),
    maxSearchTimeMs: clampInt(
      overrides.maxSearchTimeMs ??
        envInt("SEARCH_MAX_TIME_MS") ??
        DEFAULT_SEARCH_BUDGET.maxSearchTimeMs,
      10_000,
      600_000,
    ),
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

const DIFFICULTY_MULTIPLIER: Record<CategoryDifficulty, number> = {
  EASY: 6,
  MEDIUM: 10,
  HARD: 15,
  VERY_HARD: 20,
};

/**
 * Multi-round adaptive discovery engine.
 *
 * The engine only DISCOVERS candidates. It measures query/family performance,
 * adapts the query mix, respects the search budget and stops with an explicit
 * reason. Verification decides whether a candidate becomes a lead.
 */
export class SearchEngine {
  private readonly request: SearchRequest;
  private readonly provider: SearchProvider;
  private readonly budget: SearchBudget;
  private readonly options: PlanOptions;
  private readonly onProgress?: (event: EngineProgressEvent) => void | Promise<void>;
  private readonly clock: () => number;
  private readonly startedAt: number;

  private readonly rounds: SearchQuery[][];
  private readonly plannedQueries: SearchQuery[];
  private readonly seenQueryKeys = new Set<string>();
  private readonly executedQueryTexts = new Set<string>();
  private readonly seenResultKeys = new Set<string>();
  private readonly candidateMap = new Map<string, Candidate>();
  private readonly historicalIndex: {
    usernames: Set<string>;
    hosts: Set<string>;
    identities: Set<string>;
  };
  private readonly familyStats = new Map<QueryFamily, FamilyStats>();
  private readonly earlyRejectCounts: Record<Exclude<EarlyRejectReason, null>, number> = {
    NO_IDENTITY: 0,
    NOISE: 0,
    PERSONAL: 0,
    FOREIGN: 0,
  };
  private readonly rejectionCounts: RejectedBreakdown = {
    personal: 0,
    fanOrNews: 0,
    foreign: 0,
    irrelevant: 0,
    duplicates: 0,
    iranRejected: 0,
    other: 0,
  };

  private state: SearchState;
  private qualifiedCount = 0;
  private newCandidatesPerRound: number[] = [];
  private candidateOrder: Candidate[] = [];
  private rateLimited = false;

  constructor(options: EngineOptions) {
    this.request = normalizeRequest(options.request);
    this.provider = options.provider;
    this.budget = resolveBudget(this.request.limit, options.budget);
    this.onProgress = options.onProgress;
    this.clock = options.now ?? (() => Date.now());
    this.startedAt = this.clock();

    const capabilities: ProviderCapabilities = options.provider.capabilities;
    this.options = {
      capabilities,
      maxRounds: this.budget.maxRounds,
      queriesPerRound: Math.max(3, Math.ceil(this.budget.maxQueries / this.budget.maxRounds)),
    };

    this.rounds = planRounds(this.request, this.options);
    this.plannedQueries = this.rounds.flat();

    this.historicalIndex = buildHistoricalIndex(options.historical);

    this.state = {
      request: {
        category: this.request.category,
        country: this.request.country,
        city: this.request.city ?? null,
        limit: this.request.limit,
      },
      currentRound: 0,
      maxRounds: this.budget.maxRounds,
      queriesGenerated: this.plannedQueries.length,
      queriesExecuted: 0,
      queriesFailed: 0,
      rawResults: 0,
      uniqueResults: 0,
      candidates: 0,
      historicalDuplicates: 0,
      sessionDuplicates: 0,
      rejectedEarly: 0,
      qualifiedCount: 0,
      difficulty: "MEDIUM",
      targetCandidates: targetCandidates(this.request.limit, "MEDIUM", this.budget.maxCandidates),
      queryStats: [],
      familyStats: [],
      failurePatterns: [],
      providerErrors: [],
      partialSearch: false,
      stoppedReason: null,
    };
  }

  get candidates(): Candidate[] {
    return this.candidateOrder;
  }

  /** Read-only view of the search state (observability / tests). */
  get snapshot(): SearchState {
    return { ...this.state };
  }

  get queryStats(): QueryStats[] {
    return [...this.state.queryStats];
  }

  get diagnostics(): SearchDiagnostics {
    return {
      provider: this.provider.isMock ? "mock" : this.provider.name,
      mockMode: this.provider.isMock,
      queriesGenerated: this.state.queriesGenerated,
      queriesExecuted: this.state.queriesExecuted,
      queriesFailed: this.state.queriesFailed,
      rawResults: this.state.rawResults,
      uniqueResults: this.state.uniqueResults,
      candidates: this.state.candidates,
      historicalDuplicates: this.state.historicalDuplicates,
      sessionDuplicates: this.state.sessionDuplicates,
      rejectedEarly: this.state.rejectedEarly,
      rounds: this.state.currentRound,
      maxRounds: this.state.maxRounds,
      stopReason: this.state.stoppedReason,
      partialSearch: this.state.partialSearch,
      difficulty: this.state.difficulty,
      familyStats: [...this.familyStats.values()].sort((a, b) => b.value - a.value),
      failurePatterns: this.state.failurePatterns,
      providerErrors: [...new Set(this.state.providerErrors)].slice(0, 5),
    };
  }

  isStopped(): boolean {
    return this.state.stoppedReason !== null;
  }

  hasMoreRounds(): boolean {
    return !this.isStopped() && this.state.currentRound < this.budget.maxRounds;
  }

  stop(reason: StopReason): void {
    if (!this.state.stoppedReason) this.state.stoppedReason = reason;
  }

  /** Verification reports back how many candidates became real leads. */
  noteQualified(count: number, rejected?: Partial<RejectedBreakdown>): void {
    this.qualifiedCount = Math.max(this.qualifiedCount, count);
    this.state.qualifiedCount = this.qualifiedCount;
    if (rejected) {
      for (const key of Object.keys(this.rejectionCounts) as (keyof RejectedBreakdown)[]) {
        const value = rejected[key];
        if (typeof value === "number") this.rejectionCounts[key] += value;
      }
    }
    if (this.qualifiedCount >= this.request.limit) this.stop("ENOUGH_QUALIFIED_LEADS");
  }

  // -------------------------------------------------------------------------
  // Round execution
  // -------------------------------------------------------------------------

  async runNextRound(): Promise<RoundOutcome> {
    if (this.isStopped()) {
      return this.outcome(0, 0);
    }
    if (this.state.currentRound >= this.budget.maxRounds) {
      this.stop("MAX_ROUNDS");
      return this.outcome(0, 0);
    }

    const round = this.state.currentRound + 1;
    this.state.currentRound = round;

    const queries = this.selectQueriesForRound(round);
    if (!queries.length) {
      this.stop("NO_MORE_USEFUL_RESULTS");
      return this.outcome(0, 0);
    }

    await this.emit({
      kind: "round_start",
      round,
      maxRounds: this.budget.maxRounds,
      planned: queries.length,
      detail: `دور ${round} از ${this.budget.maxRounds} — ${queries.length} کوئری`,
    });

    const before = this.candidateMap.size;
    let executed = 0;

    const concurrency = this.provider.isMock ? 4 : 3;
    for (let i = 0; i < queries.length; i += concurrency) {
      if (this.isStopped()) break;
      if (this.clock() - this.startedAt > this.budget.maxSearchTimeMs) {
        this.stop("TIME_BUDGET_EXHAUSTED");
        this.state.partialSearch = true;
        break;
      }
      const chunk = queries.slice(i, i + concurrency);
      if (this.remainingBudget() <= 0) {
        this.stop("SEARCH_BUDGET_EXHAUSTED");
        break;
      }
      const limited = chunk.slice(0, this.remainingBudget());

      const settled = await Promise.allSettled(
        limited.map((query) =>
          executeQuery(this.provider, query, {
            seenResultKeys: this.seenResultKeys,
            maxResults: Math.min(
              this.budget.maxResultsPerQuery,
              this.provider.capabilities.maxResultsPerQuery,
            ),
            now: () => new Date(this.clock()),
          }),
        ),
      );

      for (let j = 0; j < settled.length; j += 1) {
        const query = limited[j];
        const item = settled[j];
        if (!query) continue;
        executed += 1;
        this.state.queriesExecuted += 1;

        if (item?.status === "fulfilled") {
          const execution = item.value;
          if (execution.stats.status === "ok" || execution.stats.status === "empty") {
            this.absorbQueryResults(query, execution.stats, execution.results);
          } else {
            this.recordFailedQuery(query, round, execution.stats);
          }
        } else {
          const reason = item?.reason;
          this.recordFailedQuery(query, round, null, reason instanceof Error ? reason.message : "query failed");
        }
      }
    }

    const newCandidates = this.candidateMap.size - before;
    this.newCandidatesPerRound.push(newCandidates);
    this.updateDifficulty();
    this.state.failurePatterns = this.detectFailurePatterns();
    this.refreshCandidateOrder();
    this.evaluateStopConditions(round);

    await this.emit({
      kind: "round_done",
      round,
      candidates: this.candidateMap.size,
      newCandidates,
      detail: `${this.candidateMap.size} کاندیدا (${newCandidates} جدید در این دور)`,
      stopReason: this.state.stoppedReason,
    });

    return this.outcome(executed, newCandidates);
  }

  private outcome(executed: number, newCandidates: number): RoundOutcome {
    return {
      round: this.state.currentRound,
      queriesExecuted: executed,
      newCandidates,
      totalCandidates: this.candidateMap.size,
      stopReason: this.state.stoppedReason,
      stopped: this.isStopped(),
    };
  }

  private remainingBudget(): number {
    return Math.max(0, this.budget.maxQueries - this.state.queriesExecuted);
  }

  /**
   * Records a failed query without crashing the search.
   * Rate limits are respected (no retry, no proxy) and stop the search.
   */
  private recordFailedQuery(
    query: SearchQuery,
    round: number,
    stats: QueryStats | null,
    fallbackMessage?: string,
  ): void {
    const status = stats?.status ?? "error";
    const message = stats?.error ?? fallbackMessage ?? "query failed";
    if (status === "rate_limited") this.rateLimited = true;

    this.state.queriesFailed += 1;
    this.state.partialSearch = true;
    this.executedQueryTexts.add(query.query);
    this.state.providerErrors.push(publicProviderError(message));
    this.state.queryStats.push(
      stats ?? {
        query: query.query,
        family: query.family,
        round,
        executedAt: new Date(this.clock()).toISOString(),
        status,
        error: publicProviderError(message),
        resultCount: 0,
        newResults: 0,
        duplicateResults: 0,
        newCandidateCount: 0,
        duplicateCandidateCount: 0,
        historicalDuplicateCount: 0,
        businessishCount: 0,
        rejectedEarlyCount: 0,
        estimatedValue: 0,
      },
    );
    this.noteFamily(query.family, 0, 0);
    void this.emit({
      kind: "query",
      query: query.query,
      family: query.family,
      round,
      executed: this.state.queriesExecuted,
      budget: this.budget.maxQueries,
      status,
      results: 0,
    });
  }

  private absorbQueryResults(query: SearchQuery, stats: QueryStats, results: SearchResultItem[] = []): void {
    this.executedQueryTexts.add(query.query);
    const extracted = extractCandidates(results, {
      round: query.round,
      category: this.request.category,
      city: this.request.city ?? null,
    });

    let newCandidates = 0;
    let historical = 0;
    let businessish = 0;
    let rejectedEarly = 0;

    for (const candidate of extracted) {
      if (this.isHistorical(candidate)) {
        historical += 1;
        this.state.historicalDuplicates += 1;
        continue;
      }
      const existing = this.candidateMap.get(candidate.identityKey);
      if (existing) {
        this.state.sessionDuplicates += 1;
        mergeCandidate(existing, candidate);
        continue;
      }
      const decision = earlyReject(candidate, {
        category: this.request.category,
        city: this.request.city ?? null,
      });
      if (decision.reject) {
        rejectedEarly += 1;
        this.state.rejectedEarly += 1;
        if (decision.reason) this.earlyRejectCounts[decision.reason] += 1;
        continue;
      }
      const signals = cheapSignals(candidate, {
        category: this.request.category,
        city: this.request.city ?? null,
      });
      if (signals.commercial || signals.product || signals.ordering) businessish += 1;
      this.candidateMap.set(candidate.identityKey, candidate);
      newCandidates += 1;
    }

    this.state.rawResults += stats.resultCount;
    this.state.uniqueResults += stats.newResults;
    this.state.candidates = this.candidateMap.size;

    const estimatedValue = Number(
      (newCandidates + businessish * 0.5 - stats.duplicateResults * 0.05).toFixed(2),
    );

    this.state.queryStats.push({
      ...stats,
      newCandidateCount: newCandidates,
      historicalDuplicateCount: historical,
      businessishCount: businessish,
      rejectedEarlyCount: rejectedEarly,
      estimatedValue,
    });

    this.noteFamily(query.family, stats.newResults, newCandidates, businessish);

    void this.emit({
      kind: "query",
      query: query.query,
      family: query.family,
      round: query.round,
      executed: this.state.queriesExecuted,
      budget: this.budget.maxQueries,
      status: stats.status,
      results: stats.newResults,
    });
  }

  // -------------------------------------------------------------------------
  // Query selection: scheduled + exploitation + exploration floor + adaptive
  // -------------------------------------------------------------------------

  private selectQueriesForRound(round: number): SearchQuery[] {
    const scheduled = (this.rounds[round - 1] ?? []).filter((query) => this.isFresh(query));
    const picked: SearchQuery[] = [];
    const perRound = this.options.queriesPerRound;
    const take = (queries: SearchQuery[]) => {
      for (const query of queries) {
        if (picked.length >= perRound) break;
        if (picked.some((item) => item.query.toLowerCase() === query.query.toLowerCase())) continue;
        if (!this.isFresh(query)) continue;
        this.seenQueryKeys.add(this.queryKeyOf(query));
        picked.push(query);
      }
    };

    if (round === ADAPTIVE_ROUND) {
      const patterns = this.detectFailurePatterns();
      this.state.failurePatterns = patterns;
      if (patterns.length) {
        take(
          adaptiveQueryPlan(patterns, this.request, this.options, [
            ...this.executedQueryTexts,
          ], 6).map((query) => ({ ...query, round })),
        );
      }
      take(this.exploitationQueries(4, round));
    }

    take(scheduled);

    if (round > 1) {
      // Exploitation: repeat the structure of what is already working.
      take(this.exploitationQueries(Math.max(1, Math.floor(perRound / 3)), round));
      // Exploration floor: never spend a whole round on one family.
      take(this.explorationQueries(1, round));
    }

    if (round >= this.budget.maxRounds) {
      take(
        followUpQueries(this.candidateOrder.slice(0, 6), this.request, this.options, [
          ...this.executedQueryTexts,
        ], 3).map((query) => ({ ...query, round })),
      );
    }

    if (!picked.length) {
      take(this.remainingPlannedQueries(round, perRound));
    }

    return picked.slice(0, Math.max(1, perRound));
  }

  private isFresh(query: SearchQuery): boolean {
    return !this.seenQueryKeys.has(this.queryKeyOf(query));
  }

  private queryKeyOf(query: SearchQuery): string {
    return matchKey(query.query);
  }

  private remainingPlannedQueries(round: number, limit: number): SearchQuery[] {
    return this.plannedQueries
      .filter((query) => this.isFresh(query))
      .slice(0, limit)
      .map((query) => ({ ...query, round }));
  }

  /** Queries from the best-performing families not yet used. */
  private exploitationQueries(limit: number, round: number): SearchQuery[] {
    const ranked = [...this.familyStats.values()]
      .filter((stat) => stat.executed > 0)
      .sort((a, b) => b.value - a.value);
    const out: SearchQuery[] = [];
    for (const stat of ranked) {
      if (out.length >= limit) break;
      const queries = this.plannedQueries
        .filter((query) => query.family === stat.family && this.isFresh(query))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 2)
        .map((query) => ({ ...query, round, mode: "exploitation" as const }));
      out.push(...queries);
    }
    return out.slice(0, limit);
  }

  /** One query from the least-used family to keep the search diverse. */
  private explorationQueries(limit: number, round: number): SearchQuery[] {
    const usage = new Map<QueryFamily, number>();
    for (const stat of this.familyStats.values()) usage.set(stat.family, stat.executed);
    const families = [...new Set(this.plannedQueries.map((query) => query.family))].sort(
      (a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0),
    );
    const out: SearchQuery[] = [];
    for (const family of families) {
      if (out.length >= limit) break;
      const query = this.plannedQueries
        .filter((item) => item.family === family && this.isFresh(item))
        .sort((a, b) => b.priority - a.priority)[0];
      if (query) out.push({ ...query, round, mode: "exploration" });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Measurement
  // -------------------------------------------------------------------------

  private noteFamily(family: QueryFamily, results: number, newCandidates: number, businessish = 0): void {
    const current =
      this.familyStats.get(family) ??
      ({ family, executed: 0, results: 0, newCandidates: 0, businessish: 0, yieldPerQuery: 0, value: 0 } as FamilyStats);
    current.executed += 1;
    current.results += results;
    current.newCandidates += newCandidates;
    current.businessish += businessish;
    current.yieldPerQuery = Number((current.newCandidates / current.executed).toFixed(2));
    const maxYield = Math.max(
      0.01,
      ...[...this.familyStats.values()].map((stat) => stat.yieldPerQuery),
    );
    for (const stat of this.familyStats.values()) {
      stat.value = Math.round(
        100 * (0.7 * (stat.yieldPerQuery / maxYield) + 0.3 * (stat.businessish / Math.max(1, stat.newCandidates))),
      );
    }
    this.familyStats.set(family, current);
    this.state.familyStats = [...this.familyStats.values()];
  }

  private updateDifficulty(): void {
    const queries = Math.max(1, this.state.queriesExecuted);
    const yieldPerQuery = this.candidateMap.size / queries;
    const difficulty: CategoryDifficulty =
      yieldPerQuery >= 1.5 ? "EASY" : yieldPerQuery >= 0.8 ? "MEDIUM" : yieldPerQuery >= 0.3 ? "HARD" : "VERY_HARD";
    this.state.difficulty = difficulty;
    this.state.targetCandidates = targetCandidates(this.request.limit, difficulty, this.budget.maxCandidates);
  }

  private refreshCandidateOrder(): void {
    this.candidateOrder = [...this.candidateMap.values()].sort(
      (a, b) => b.promiseScore - a.promiseScore,
    );
  }

  private detectFailurePatterns(): FailurePattern[] {
    const patterns: FailurePattern[] = [];
    const candidates = this.candidateOrder;
    const seen = candidates.length + this.state.rejectedEarly + this.state.historicalDuplicates;
    if (seen < 4) return patterns;

    const foreignish =
      this.rejectionCounts.foreign +
      this.earlyRejectCounts.FOREIGN +
      candidates.filter((candidate) =>
        /dubai|دبی|istanbul|استانبول|turkey|ترکیه|uae|امارات/i.test(candidate.textBlob ?? ""),
      ).length;
    const personalish =
      this.rejectionCounts.personal +
      this.earlyRejectCounts.PERSONAL +
      candidates.filter((candidate) =>
        /پیج شخصی|personal|diary|خاطرات/i.test(candidate.textBlob ?? ""),
      ).length;
    const noisyish = this.rejectionCounts.fanOrNews + this.earlyRejectCounts.NOISE;
    const duplicateRate =
      this.state.historicalDuplicates + this.state.sessionDuplicates > 0
        ? (this.state.historicalDuplicates + this.state.sessionDuplicates) /
          Math.max(1, this.state.uniqueResults)
        : 0;
    const commercialRate = candidates.length
      ? candidates.filter((candidate) =>
          /فروشگاه|فروش|خرید|سفارش|قیمت|shop|store|order|price/i.test(candidate.textBlob ?? ""),
        ).length / candidates.length
      : 0;

    const thresholdForeign = Math.max(3, seen * 0.3);
    const thresholdPersonal = Math.max(3, seen * 0.25);
    if (foreignish > thresholdForeign) patterns.push("TOO_MANY_FOREIGN");
    if (personalish > thresholdPersonal) patterns.push("TOO_MANY_PERSONAL");
    if (noisyish > thresholdPersonal) patterns.push("TOO_MANY_NEWS");
    if (duplicateRate > 0.6) patterns.push("TOO_MANY_DUPLICATES");
    if (this.rejectionCounts.iranRejected > Math.max(3, candidates.length * 0.3)) {
      patterns.push("TOO_FEW_IRANIAN_RESULTS");
    }
    if (commercialRate < 0.4 && candidates.length >= 4) patterns.push("TOO_FEW_COMMERCIAL_RESULTS");
    if (this.rejectionCounts.irrelevant > Math.max(4, candidates.length * 0.4)) {
      patterns.push("LOW_CATEGORY_RELEVANCE");
    }
    if (candidates.length < Math.max(2, Math.floor(this.request.limit / 4))) {
      patterns.push("TOO_FEW_BUSINESSES");
    }
    return [...new Set(patterns)].slice(0, 4);
  }

  private evaluateStopConditions(round: number): void {
    if (this.isStopped()) return;

    if (this.qualifiedCount >= this.request.limit) {
      this.stop("ENOUGH_QUALIFIED_LEADS");
      return;
    }

    if (this.rateLimited) {
      // Respect the provider limit: stop, keep results, never bypass.
      this.state.partialSearch = true;
      this.stop("PROVIDER_LIMIT");
      return;
    }

    if (this.state.queriesExecuted > 0 && this.state.rawResults === 0) {
      if (this.state.queriesFailed >= this.state.queriesExecuted) {
        this.stop("PROVIDER_FAILURE");
        return;
      }
      if (round >= 2) {
        this.stop("NO_RESULTS");
        return;
      }
    }

    if (this.clock() - this.startedAt > this.budget.maxSearchTimeMs) {
      this.state.partialSearch = true;
      this.stop("TIME_BUDGET_EXHAUSTED");
      return;
    }

    if (this.state.queriesExecuted >= this.budget.maxQueries) {
      this.stop("SEARCH_BUDGET_EXHAUSTED");
      return;
    }

    if (this.candidateMap.size >= this.budget.maxCandidates) {
      this.stop("SEARCH_BUDGET_EXHAUSTED");
      return;
    }

    // Diminishing returns: recent rounds produce almost nothing new.
    const recent = this.newCandidatesPerRound.slice(-2);
    if (
      this.newCandidatesPerRound.length >= 3 &&
      recent.length === 2 &&
      recent.every((value) => value <= Math.max(1, Math.floor(this.request.limit * 0.05)))
    ) {
      this.stop("DIMINISHING_RETURNS");
      return;
    }

    if (round >= this.budget.maxRounds) this.stop("MAX_ROUNDS");
  }

  private isHistorical(candidate: Candidate): boolean {
    const username = normalizeUsername(candidate.username);
    if (username && this.historicalIndex.usernames.has(username)) return true;
    const host = canonicalizeUrl(candidate.website ?? "")?.host;
    if (host && this.historicalIndex.hosts.has(host)) return true;
    return this.historicalIndex.identities.has(identityOf(candidate));
  }

  private async emit(event: EngineProgressEvent): Promise<void> {
    if (!this.onProgress) return;
    await this.onProgress(event);
  }
}

type IdentityInput = {
  username?: string | null;
  instagramUrl?: string | null;
  website?: string | null;
  businessName?: string | null;
  sourceUrls?: string[] | null;
};

/** Canonical identity used for historical dedupe: username → website → name. */
function identityOf(input: IdentityInput): string {
  const username = normalizeUsername(input.username ?? input.instagramUrl);
  if (username) return `ig:${username}`;
  const host = canonicalizeUrl(input.website ?? "")?.host;
  if (host) return `web:${host}`;
  const name = matchKey(input.businessName ?? "");
  if (name) return `name:${name}`;
  return `url:${input.sourceUrls?.[0] ?? ""}`;
}

function buildHistoricalIndex(historical: Lead[]): {
  usernames: Set<string>;
  hosts: Set<string>;
  identities: Set<string>;
} {
  const usernames = new Set<string>();
  const hosts = new Set<string>();
  const identities = new Set<string>();
  for (const lead of historical) {
    const username = normalizeUsername(lead.username ?? lead.instagramUrl);
    if (username) usernames.add(username);
    const host = canonicalizeUrl(lead.website ?? "")?.host;
    if (host && !host.endsWith("instagram.com")) hosts.add(host);
    identities.add(identityOf(lead));
  }
  return { usernames, hosts, identities };
}

function mergeCandidate(target: Candidate, incoming: Candidate): Candidate {
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
  target.website = target.website ?? incoming.website;
  target.businessName = target.businessName ?? incoming.businessName;
  target.telegram = target.telegram ?? incoming.telegram;
  target.whatsapp = target.whatsapp ?? incoming.whatsapp;
  target.promiseScore = Math.max(target.promiseScore, incoming.promiseScore);
  return target;
}

export function targetCandidates(
  limit: number,
  difficulty: CategoryDifficulty,
  maxCandidates: number,
): number {
  const base = Math.ceil(limit * DIFFICULTY_MULTIPLIER[difficulty]);
  return Math.min(maxCandidates, Math.max(Math.max(30, limit * 4), base));
}

/** Strips secrets from provider error messages before they reach the UI. */
function publicProviderError(message: string): string {
  return message.replace(/sk-[a-zA-Z0-9]+/g, "[redacted]").replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 200);
}
