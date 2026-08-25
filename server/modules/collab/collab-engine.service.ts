/**
 * The round loop that makes two or more accounts argue until they converge.
 *
 * The engine never imports a provider runtime; it receives one as a function.
 * Asserting convergence, exhaustion, stop and failure without spending money —
 * or a network — is only possible when the test owns that function. It is also
 * a boundary: dispatching to a provider drags in the SDK layer, session
 * bookkeeping and per-profile environment isolation, none of which belongs
 * here. Profile display names arrive the same way, for the same reason.
 *
 * `run()` is started fire-and-forget by the create route, so it must never
 * reject: every failure has to end as a `failed` row the poller can read.
 */

import { randomUUID } from 'node:crypto';

import {
  buildTurnPrompt,
  buildVerdictPrompt,
  hasConverged,
  parseConsensus,
} from './collab-prompt.service.js';
import { createRunState } from './collab-run-state.js';
import { callRuntimeWithTimeout } from './collab-runtime.js';
import { collabRepository } from './collab.repository.js';
import { mapCollaborationRow } from './collab.types.js';
import { contractConsensus, createCouncilRun } from './council-run.service.js';
import type {
  PromptParticipant,
  PromptTranscriptEntry,
  RoundTurnSignal,
} from './collab-prompt.service.js';
import type { CollabRuntime } from './collab-runtime.js';
import type { AppendTurnInput, CollabParticipant } from './collab.types.js';

/** Re-exported so the composition root imports the whole seam from one place. */
export type { CollabRuntime };

export interface CollabEngineDeps {
  runtime: CollabRuntime;
  repository?: typeof collabRepository;
  /** Overrides the run's own budget; the tests use it to expire a turn fast. */
  turnTimeoutMs?: number;
  /** Names shown in prompts and in the verdict; defaults to the profile id. */
  resolveName?: (profileId: string) => string;
}

export interface CollabEngine {
  run(collaborationId: string): Promise<void>;
}

const UNKNOWN_RUNTIME_ERROR = 'The collaboration runtime failed.';

const NOTHING_TO_SYNTHESIZE_ERROR = 'No participant produced an answer to synthesize.';

export function createCollabEngine(deps: CollabEngineDeps): CollabEngine {
  const repository = deps.repository ?? collabRepository;
  const resolveName = deps.resolveName ?? ((profileId: string): string => profileId);
  // Every status this loop writes goes through here, and every one of them is
  // conditional on the run still being running.
  const state = createRunState(repository);

  const toPromptParticipant = (participant: CollabParticipant): PromptParticipant => ({
    name: resolveName(participant.profileId),
    role: participant.role,
  });

  async function execute(id: string): Promise<void> {
    const initial = state.read(id);
    if (!initial) return;

    const collaboration = mapCollaborationRow(initial);
    const { mode, topic, participants, projectPath, budget } = collaboration;
    if (participants.length === 0) {
      state.fail(id, 'This collaboration has no participants to run.');
      return;
    }

    // The run's own budget, unless a caller overrode the deadline — which only
    // the tests do, to expire a turn without waiting five minutes for it.
    const turnTimeoutMs = deps.turnTimeoutMs ?? budget.turnTimeoutMs;
    const council = createCouncilRun({ mode, budget });

    const record = (turn: Omit<AppendTurnInput, 'id' | 'collaborationId'>): void => {
      repository.appendTurn({ id: randomUUID(), collaborationId: id, ...turn });
    };

    // A vote is one blind answer per participant: the stored ceiling is
    // irrelevant, and nothing in a first round could make a second meaningful.
    const totalRounds = mode === 'vote' ? 1 : Math.max(1, collaboration.maxRounds);
    const transcript: PromptTranscriptEntry[] = [];
    let converged = false;
    let roundsRun = 0;
    let firstTurnError: string | null = null;
    let outOfBudget = false;

    for (let round = 1; round <= totalRounds && !converged && !outOfBudget; round += 1) {
      // Checked before the round is claimed so an unaffordable round never
      // shows up as progress the UI would display and nobody spent.
      if (council.blockedBy() !== null) break;
      // The round marker doubles as the stop check.
      if (!state.claimRound(id, round)) return;
      roundsRun = round;

      const signals: RoundTurnSignal[] = [];

      for (let turnIndex = 0; turnIndex < participants.length; turnIndex += 1) {
        // Checked before every turn so a stop costs nothing more; a turn
        // already paid for is still a turn we record.
        if (!state.read(id)) return;

        // The budget is checked in the same place and for the same reason: the
        // cheapest turn is the one that never starts. A run that runs out
        // mid-round still synthesizes what it already paid for.
        if (council.blockedBy() !== null) {
          outOfBudget = true;
          break;
        }

        const participant = participants[turnIndex];
        const { profileId, provider, model, effort, role: participantRole } = participant;
        // A vote is answered blind by design, so its author sees no transcript.
        const visible = mode === 'vote' ? [] : transcript;
        const prompt = buildTurnPrompt({
          mode,
          topic,
          round,
          maxRounds: totalRounds,
          self: toPromptParticipant(participant),
          others: participants.filter((_, index) => index !== turnIndex).map(toPromptParticipant),
          transcript: visible,
          budget: council.promptBudget(),
        });

        const { content, error, fatal, usage } = await callRuntimeWithTimeout(
          deps.runtime,
          // The seat's own model and effort travel with every one of its turns.
          { prompt, profileId, provider, cwd: projectPath, model, effort },
          turnTimeoutMs,
        );

        const { contract, contractError } = council.record({
          profileId, round, role: 'participant', content, error, usage,
        });
        // Vote turns are never asked to declare consensus, so they never carry
        // one; a council declares it through its contract instead of a line.
        const consensus =
          error !== null || mode === 'vote'
            ? null
            : mode === 'council'
              ? contractConsensus(contract)
              : parseConsensus(content);

        record({
          round, turnIndex, profileId, role: 'participant', content, consensus, error,
          contract, contractError, usage,
        });

        if (error !== null && firstTurnError === null) firstTurnError = error;
        if (fatal) {
          state.fail(id, error ?? UNKNOWN_RUNTIME_ERROR, council.summary());
          return;
        }

        // An opening turn is asked to agree with a position that does not exist
        // yet. Its answer is kept as written, but a "yes" to nobody cannot end a
        // collaboration before a single disagreement was explored.
        signals.push({
          role: participantRole,
          consensus: visible.length === 0 ? null : consensus,
        });
        if (content) {
          transcript.push({ name: resolveName(profileId), role: participantRole, round, content });
        }
      }

      converged = hasConverged({ mode, roundTurns: signals });
    }

    if (!state.read(id)) return;

    // Every turn failed. An arbiter handed an empty transcript has nothing to
    // read, so it would bill one more call and answer with a verdict on a
    // discussion that never happened; the run ends on the reason it broke.
    if (transcript.length === 0) {
      state.fail(id, firstTurnError ?? NOTHING_TO_SYNTHESIZE_ERROR, council.summary());
      return;
    }

    // The arbiter is the first participant, by definition.
    // Synthesis runs on the arbiter's own model too: a seat picked for its
    // reasoning would otherwise write the verdict on the CLI's default.
    const { profileId, provider, model, effort } = participants[0];
    const prompt = buildVerdictPrompt({ topic, mode, transcript });
    const verdict = await callRuntimeWithTimeout(
      deps.runtime,
      { prompt, profileId, provider, cwd: projectPath, model, effort },
      turnTimeoutMs,
    );

    // The synthesis is a turn like any other, so a failed one stays visible in
    // the transcript instead of vanishing behind a status change — and it is
    // billed like any other, so the budget hears about it too.
    const { content, error, usage } = verdict;
    const turnIndex = participants.length;
    council.record({ profileId, round: roundsRun, role: 'arbiter', content, error, usage });
    record({ round: roundsRun, turnIndex, profileId, role: 'arbiter', content, error, usage });

    if (verdict.fatal) {
      state.fail(id, error ?? UNKNOWN_RUNTIME_ERROR, council.summary());
      return;
    }

    state.finish(id, {
      status: converged ? 'converged' : 'exhausted',
      verdict: content || null,
      currentRound: roundsRun,
      // Computed, never generated: the arbiter writes the prose, this is the
      // part a caller can read without one.
      summary: council.summary(),
    });
  }

  return {
    async run(collaborationId: string): Promise<void> {
      try {
        await execute(collaborationId);
      } catch (error) {
        console.error('[collab] collaboration run aborted unexpectedly:', error);
        state.fail(collaborationId, error instanceof Error ? error.message : String(error));
      }
    },
  };
}
