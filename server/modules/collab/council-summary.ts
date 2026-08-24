/**
 * The council's own read of itself: what the participants agreed on, what they
 * still dispute, what they are afraid of, how sure they ended up, and what the
 * run cost.
 *
 * The arbiter already writes a prose verdict, and that is where the *meaning*
 * lives. This object is the other half — the part a person can scan in two
 * seconds and a caller can query without an LLM in the loop. It is therefore
 * computed, not generated: every number here is derived from the stored
 * contracts by pure code, so it cannot hallucinate an agreement that never
 * happened and it costs nothing to recompute.
 *
 * The price of that honesty is that grouping is textual, not semantic: two
 * participants who made the same point in different words are counted as two
 * points. Overstating agreement would be the worse failure of the two, and the
 * verdict is where nuance belongs.
 */

import { RISK_SEVERITIES } from './council-contract.js';
import type { CouncilBudget } from './collab-budget.js';
import type { CouncilContract, RiskSeverity } from './council-contract.js';

/** Why the round loop stopped early, when it did. */
export type BudgetStop = 'tokens' | 'turns' | null;

export interface CouncilTurnContract {
  profileId: string;
  round: number;
  contract: CouncilContract | null;
  contractError: string | null;
}

export interface CouncilAgreement {
  point: string;
  agreedBy: string[];
}

export interface CouncilDispute {
  point: string;
  raisedBy: string[];
  /** Who or what is being disputed: other participants, or `premise`. */
  against: string[];
}

export interface CouncilAggregatedRisk {
  risk: string;
  /** The highest severity any participant gave it; a worry is not averaged down. */
  severity: RiskSeverity;
  raisedBy: string[];
}

export interface CouncilConfidenceStats {
  min: number;
  median: number;
  max: number;
  /** One entry per participant, holding its latest stated confidence. */
  byParticipant: { profileId: string; value: number }[];
}

export interface CouncilBudgetUsage {
  totalTokens: number;
  maxTurns: number;
  tokensUsed: number;
  turnsUsed: number;
  stoppedBy: BudgetStop;
}

export interface CouncilSummary {
  /** Turns that yielded a contract, whole or partial. */
  contractsParsed: number;
  /**
   * Turns whose contract could not be read in full. A partial answer counts in
   * both tallies on purpose: what it stated was used, and what it omitted is
   * still a gap the reader should know about.
   */
  contractsFailed: number;
  agreements: CouncilAgreement[];
  disputes: CouncilDispute[];
  risks: CouncilAggregatedRisk[];
  /** `null` when no participant stated a confidence at all. */
  confidence: CouncilConfidenceStats | null;
  budget: CouncilBudgetUsage;
}

/** Grouping key: case, spacing and trailing punctuation are not the point. */
const groupKey = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').replace(/[.;,!?]+$/, '').trim();

interface Group<T> {
  value: T;
  by: string[];
}

/**
 * Groups entries by the key of their text, keeping the first spelling seen and
 * the distinct participants behind it. Insertion order is preserved so the
 * caller can sort deliberately instead of inheriting a hash order.
 */
function groupBy<TEntry, TValue>(
  entries: { profileId: string; entry: TEntry }[],
  key: (entry: TEntry) => string,
  fold: (current: TValue | undefined, entry: TEntry) => TValue,
): Group<TValue>[] {
  const groups = new Map<string, Group<TValue>>();

  for (const { profileId, entry } of entries) {
    const id = key(entry);
    if (!id) continue;
    const existing = groups.get(id);
    if (existing) {
      existing.value = fold(existing.value, entry);
      if (!existing.by.includes(profileId)) existing.by.push(profileId);
    } else {
      groups.set(id, { value: fold(undefined, entry), by: [profileId] });
    }
  }

  return [...groups.values()];
}

function flatten<T>(
  turns: CouncilTurnContract[],
  pick: (contract: CouncilContract) => T[],
): { profileId: string; entry: T }[] {
  return turns.flatMap((turn) =>
    (turn.contract ? pick(turn.contract) : []).map((entry) => ({ profileId: turn.profileId, entry })),
  );
}

/** The last contract each participant produced: a council is judged on its close. */
function latestContracts(turns: CouncilTurnContract[]): Map<string, CouncilContract> {
  const latest = new Map<string, CouncilContract>();
  for (const turn of turns) {
    if (turn.contract) latest.set(turn.profileId, turn.contract);
  }
  return latest;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function confidenceStats(turns: CouncilTurnContract[]): CouncilConfidenceStats | null {
  const byParticipant = [...latestContracts(turns).entries()]
    .filter(([, contract]) => contract.confidence !== null)
    .map(([profileId, contract]) => ({ profileId, value: contract.confidence?.value ?? 0 }));

  if (byParticipant.length === 0) return null;
  const values = byParticipant.map((entry) => entry.value);

  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
    byParticipant,
  };
}

/**
 * Agreement is claimed only when two different participants asserted the same
 * observation. A point one voice made is evidence, not consensus.
 */
function agreements(turns: CouncilTurnContract[]): CouncilAgreement[] {
  return groupBy(
    flatten(turns, (contract) => contract.evidence),
    (entry) => groupKey(entry.observation),
    (current: string | undefined, entry) => current ?? entry.observation,
  )
    .filter((group) => group.by.length > 1)
    .map((group) => ({ point: group.value, agreedBy: group.by }))
    .sort((left, right) => right.agreedBy.length - left.agreedBy.length);
}

function disputes(turns: CouncilTurnContract[]): CouncilDispute[] {
  return groupBy(
    flatten(turns, (contract) => contract.disagreements),
    (entry) => groupKey(entry.point),
    (current: { point: string; against: string[] } | undefined, entry) => {
      const against = current?.against ?? [];
      if (!against.includes(entry.with)) against.push(entry.with);
      return { point: current?.point ?? entry.point, against };
    },
  )
    .map((group) => ({ point: group.value.point, raisedBy: group.by, against: group.value.against }))
    .sort((left, right) => right.raisedBy.length - left.raisedBy.length);
}

function risks(turns: CouncilTurnContract[]): CouncilAggregatedRisk[] {
  const rank = (severity: RiskSeverity): number => RISK_SEVERITIES.indexOf(severity);

  return groupBy(
    flatten(turns, (contract) => contract.risks),
    (entry) => groupKey(entry.risk),
    (current: { risk: string; severity: RiskSeverity } | undefined, entry) =>
      current && rank(current.severity) >= rank(entry.severity)
        ? current
        : { risk: current?.risk ?? entry.risk, severity: entry.severity },
  )
    .map((group) => ({ ...group.value, raisedBy: group.by }))
    .sort(
      (left, right) =>
        rank(right.severity) - rank(left.severity) || right.raisedBy.length - left.raisedBy.length,
    );
}

/** Folds a run's stored contracts and its spend into one object. */
export function summarizeCouncil(input: {
  turns: CouncilTurnContract[];
  budget: CouncilBudget;
  usage: { tokensUsed: number; turnsUsed: number; stoppedBy: BudgetStop };
}): CouncilSummary {
  const { turns, budget, usage } = input;

  return {
    contractsParsed: turns.filter((turn) => turn.contract !== null).length,
    contractsFailed: turns.filter((turn) => turn.contractError !== null).length,
    agreements: agreements(turns),
    disputes: disputes(turns),
    risks: risks(turns),
    confidence: confidenceStats(turns),
    budget: {
      totalTokens: budget.totalTokens,
      maxTurns: budget.maxTurns,
      tokensUsed: usage.tokensUsed,
      turnsUsed: usage.turnsUsed,
      stoppedBy: usage.stoppedBy,
    },
  };
}
