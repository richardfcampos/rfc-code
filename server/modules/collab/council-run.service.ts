/**
 * The bookkeeping one council run needs while it is running: what each turn
 * stated, what each turn cost, and whether there is anything left to spend.
 *
 * It is separate from the engine because the engine is a loop over rounds and
 * this is the state that loop carries — a mutable tally with no I/O, which makes
 * both halves testable on their own: the loop against a fake runtime, the tally
 * against a list of turns.
 *
 * The mode is part of it on purpose. Only `council` is asked for a contract, so
 * only `council` records one; a debate, review or vote turn stores exactly the
 * columns it stored before this existed, with the contract columns left NULL.
 * That is what makes the contract a superset rather than a migration of
 * behaviour every existing run would have to live with.
 */

import { perTurnTokenAllowance } from './collab-budget.js';
import { parseCouncilContract } from './council-contract.js';
import { summarizeCouncil } from './council-summary.js';
import type { CouncilBudget } from './collab-budget.js';
import type { CouncilContract } from './council-contract.js';
import type { BudgetStop, CouncilSummary, CouncilTurnContract } from './council-summary.js';
import type { CollabMode, CollabTurnRole, CollabTurnUsage } from './collab.types.js';

export interface RecordedTurn {
  profileId: string;
  round: number;
  role: CollabTurnRole;
  content: string;
  /** The turn's failure, if it had one; a failed turn states nothing. */
  error: string | null;
  usage: CollabTurnUsage | null;
}

export interface RecordedContract {
  contract: CouncilContract | null;
  contractError: string | null;
}

export interface CouncilRun {
  /** The budget block for a participant prompt; absent outside council mode. */
  promptBudget(): { totalTokens: number; maxTurns: number; tokenAllowance: number } | undefined;
  /** Why no further participant turn may start, or `null` to keep going. */
  blockedBy(): BudgetStop;
  /** Files one finished turn and returns what should be stored alongside it. */
  record(turn: RecordedTurn): RecordedContract;
  summary(): CouncilSummary;
}

/**
 * A council converges when nobody disputes anything any more. A turn with no
 * readable contract declares nothing — the same `null` a missing `CONSENSUS:`
 * line produces, and for the same reason: a format the model ignored is not an
 * agreement it reached.
 */
export const contractConsensus = (contract: CouncilContract | null): boolean | null =>
  contract === null ? null : contract.disagreements.length === 0;

export function createCouncilRun(input: { mode: CollabMode; budget: CouncilBudget }): CouncilRun {
  const { mode, budget } = input;
  const isCouncil = mode === 'council';

  /**
   * One turn of the ceiling is held back for the synthesis, which is billed
   * like any other turn. At the default budget this leaves participants exactly
   * the seats × rounds they already had, so nothing shrinks by switching on.
   */
  const participantCeiling = Math.max(1, budget.maxTurns - 1);

  const contracts: CouncilTurnContract[] = [];
  let participantTurns = 0;
  let turnsUsed = 0;
  let tokensUsed = 0;
  let stoppedBy: BudgetStop = null;

  return {
    promptBudget() {
      if (!isCouncil) return undefined;
      return {
        totalTokens: budget.totalTokens,
        maxTurns: budget.maxTurns,
        tokenAllowance: perTurnTokenAllowance(budget),
      };
    },

    blockedBy(): BudgetStop {
      if (participantTurns >= participantCeiling) {
        stoppedBy = 'turns';
        return stoppedBy;
      }
      // Providers that report no usage can never trip this, which is why the
      // turn ceiling exists: one of the two always bounds a run.
      if (tokensUsed >= budget.totalTokens) {
        stoppedBy = 'tokens';
        return stoppedBy;
      }
      return null;
    },

    record(turn: RecordedTurn): RecordedContract {
      turnsUsed += 1;
      if (turn.role === 'participant') participantTurns += 1;
      if (turn.usage) tokensUsed += turn.usage.inputTokens + turn.usage.outputTokens;

      // A failed turn produced no text, and the arbiter is not a member of the
      // council: neither is asked for a contract, so neither is faulted for
      // missing one.
      if (!isCouncil || turn.role !== 'participant' || turn.error !== null) {
        return { contract: null, contractError: null };
      }

      const parsed = parseCouncilContract(turn.content);
      contracts.push({
        profileId: turn.profileId,
        round: turn.round,
        contract: parsed.contract,
        contractError: parsed.error,
      });
      return { contract: parsed.contract, contractError: parsed.error };
    },

    summary(): CouncilSummary {
      return summarizeCouncil({
        turns: contracts,
        budget,
        usage: { tokensUsed, turnsUsed, stoppedBy },
      });
    },
  };
}
