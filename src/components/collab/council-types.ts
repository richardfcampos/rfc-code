// Frontend mirror of the council contract: what a participant is required to
// state beyond prose, and the run's own computed read of what came out of it.
//
// Kept apart from `types.ts` because these shapes belong to one mode while that
// file describes every collaboration, and because the server treats them as
// best-effort: a turn that answered with half the format is still stored and
// still rendered. Every list here can therefore arrive short, and the views
// that read them guard for it rather than assuming five populated arrays.

export const RISK_SEVERITIES = ['low', 'medium', 'high'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export type TestStatus = 'proposed' | 'executed';

/** `with` names the participant disputed, or `premise` for the topic itself. */
export const PREMISE_TARGET = 'premise';

export interface CouncilEvidence {
  observation: string;
  source: string | null;
}

export interface CouncilRisk {
  risk: string;
  severity: RiskSeverity;
}

export interface CouncilTest {
  test: string;
  status: TestStatus;
  /** What running it produced; null while the test is only proposed. */
  result: string | null;
}

export interface CouncilDisagreement {
  with: string;
  point: string;
}

export interface CouncilConfidence {
  /** 0-100. */
  value: number;
  rationale: string;
}

export interface CouncilContract {
  evidence: CouncilEvidence[];
  risks: CouncilRisk[];
  tests: CouncilTest[];
  disagreements: CouncilDisagreement[];
  /** null when the turn stated no confidence, which is not the same as zero. */
  confidence: CouncilConfidence | null;
}

export interface CouncilAgreement {
  point: string;
  /** Profile ids; a point only counts as agreement once two voices made it. */
  agreedBy: string[];
}

export interface CouncilDispute {
  point: string;
  raisedBy: string[];
  against: string[];
}

export interface CouncilAggregatedRisk {
  risk: string;
  /** The highest severity any participant gave it. */
  severity: RiskSeverity;
  raisedBy: string[];
}

export interface CouncilConfidenceStats {
  min: number;
  median: number;
  max: number;
  byParticipant: { profileId: string; value: number }[];
}

/** Why the round loop stopped early, when it did. */
export type BudgetStop = 'tokens' | 'turns' | null;

export interface CouncilBudgetUsage {
  totalTokens: number;
  maxTurns: number;
  tokensUsed: number;
  turnsUsed: number;
  stoppedBy: BudgetStop;
}

/** Computed from the stored contracts once the run ends; null while it runs. */
export interface CouncilSummary {
  contractsParsed: number;
  contractsFailed: number;
  agreements: CouncilAgreement[];
  disputes: CouncilDispute[];
  risks: CouncilAggregatedRisk[];
  confidence: CouncilConfidenceStats | null;
  budget: CouncilBudgetUsage;
}
