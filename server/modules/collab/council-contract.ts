/**
 * The council contract: what a participant is required to state, beyond prose.
 *
 * A debate produces an argument; a council produces something a reader can act
 * on without re-reading the whole transcript. That means five things per turn —
 * the evidence the position rests on, the risks it accepts, the validation that
 * would settle it, where it disputes the others, and how sure its author is.
 *
 * Everything here is pure and total: a turn that ignored the format, answered
 * with half of it, or wrapped it in three paragraphs of apology must still be
 * stored and still be readable. Parsing therefore never throws and never
 * discards the original — the raw answer stays in the turn's `content`, and what
 * could not be understood comes back as a message the UI can show next to it.
 */

import { extractJsonObject } from './council-json-block.js';

export const RISK_SEVERITIES = ['low', 'medium', 'high'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const TEST_STATUSES = ['proposed', 'executed'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

/** A concrete observation, ideally with the file, symbol or command behind it. */
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
  /** What running it produced; `null` while the test is only proposed. */
  result: string | null;
}

/** `with` names the participant disputed, or `premise` for the topic itself. */
export interface CouncilDisagreement {
  with: string;
  point: string;
}

export interface CouncilConfidence {
  /** 0-100. Clamped rather than rejected: a 120 still means "very sure". */
  value: number;
  rationale: string;
}

export interface CouncilContract {
  evidence: CouncilEvidence[];
  risks: CouncilRisk[];
  tests: CouncilTest[];
  disagreements: CouncilDisagreement[];
  /** `null` when the turn stated no confidence, which is not the same as zero. */
  confidence: CouncilConfidence | null;
}

/**
 * `contract` is `null` only when nothing parsable was found at all. A partial
 * answer yields a contract *and* an error: the fields that survived are worth
 * aggregating, and the reason the rest did not is worth showing.
 */
export interface CouncilContractParseResult {
  contract: CouncilContract | null;
  error: string | null;
}

export const PREMISE_TARGET = 'premise';

const NO_JSON_ERROR =
  'No council contract JSON object was found in this answer; the raw text was kept as written.';

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Reads a field under any of its accepted spellings, first match wins. */
function readArray(source: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
    // A single entry sent unwrapped is an answer, not a violation.
    if (value !== undefined && value !== null && !Array.isArray(value)) return [value];
  }
  return undefined;
}

function mapEntries<T>(entries: unknown[], read: (entry: Record<string, unknown> | string) => T | null): T[] {
  const mapped: T[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const value = read(entry);
      if (value) mapped.push(value);
    } else if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const value = read(entry as Record<string, unknown>);
      if (value) mapped.push(value);
    }
  }
  return mapped;
}

const readEvidence = (entry: Record<string, unknown> | string): CouncilEvidence | null => {
  if (typeof entry === 'string') {
    const observation = readText(entry);
    return observation ? { observation, source: null } : null;
  }
  const observation = readText(entry.observation) ?? readText(entry.claim) ?? readText(entry.text);
  if (!observation) return null;
  return { observation, source: readText(entry.source) ?? readText(entry.ref) };
};

const readRisk = (entry: Record<string, unknown> | string): CouncilRisk | null => {
  const text = typeof entry === 'string' ? readText(entry) : readText(entry.risk) ?? readText(entry.text);
  if (!text) return null;
  const raw = typeof entry === 'string' ? null : readText(entry.severity)?.toLowerCase();
  // An unlabelled or unknown severity lands on `medium`: dropping the risk would
  // hide it, and guessing `low` would quietly discount something nobody rated.
  const severity = RISK_SEVERITIES.find((candidate) => candidate === raw) ?? 'medium';
  return { risk: text, severity };
};

const readTest = (entry: Record<string, unknown> | string): CouncilTest | null => {
  const text = typeof entry === 'string' ? readText(entry) : readText(entry.test) ?? readText(entry.name);
  if (!text) return null;
  const raw = typeof entry === 'string' ? null : readText(entry.status)?.toLowerCase();
  const status = TEST_STATUSES.find((candidate) => candidate === raw) ?? 'proposed';
  const result = typeof entry === 'string' ? null : readText(entry.result) ?? readText(entry.outcome);
  return { test: text, status, result };
};

const readDisagreement = (entry: Record<string, unknown> | string): CouncilDisagreement | null => {
  const point = typeof entry === 'string' ? readText(entry) : readText(entry.point) ?? readText(entry.text);
  if (!point) return null;
  const target = typeof entry === 'string' ? null : readText(entry.with) ?? readText(entry.target);
  return { with: target ?? PREMISE_TARGET, point };
};

function readConfidence(value: unknown): CouncilConfidence | null {
  const source =
    typeof value === 'number' || typeof value === 'string'
      ? { value, rationale: '' }
      : (value as Record<string, unknown> | null);
  if (typeof source !== 'object' || source === null) return null;

  const raw = typeof source.value === 'number' ? source.value : Number(source.value);
  if (!Number.isFinite(raw)) return null;

  return {
    value: Math.round(Math.min(100, Math.max(0, raw))),
    rationale: readText(source.rationale) ?? readText(source.reason) ?? '',
  };
}

/** Turns one raw answer into the contract it was supposed to carry. */
export function parseCouncilContract(content: string): CouncilContractParseResult {
  const source = extractJsonObject(content);
  if (!source) return { contract: null, error: NO_JSON_ERROR };

  const evidence = readArray(source, ['evidence', 'evidences']);
  const risks = readArray(source, ['risks', 'risk']);
  const tests = readArray(source, ['tests', 'test', 'validation']);
  const disagreements = readArray(source, ['disagreements', 'disagreement', 'disputes']);
  const confidence = readConfidence(source.confidence);

  const contract: CouncilContract = {
    evidence: mapEntries(evidence ?? [], readEvidence),
    risks: mapEntries(risks ?? [], readRisk),
    tests: mapEntries(tests ?? [], readTest),
    disagreements: mapEntries(disagreements ?? [], readDisagreement),
    confidence,
  };

  const missing: string[] = [];
  if (evidence === undefined) missing.push('evidence');
  if (risks === undefined) missing.push('risks');
  if (tests === undefined) missing.push('tests');
  if (disagreements === undefined) missing.push('disagreements');
  if (confidence === null) missing.push('confidence');

  return {
    contract,
    error: missing.length === 0 ? null : `Council contract is missing: ${missing.join(', ')}.`,
  };
}
