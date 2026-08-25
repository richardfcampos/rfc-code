/**
 * Server-initiated runs: how an automation gets an agent working on something.
 *
 * A run started here is indistinguishable from one a person started in the
 * composer, and deliberately so — it is a real app session, registered in the
 * same run registry, so the board's owner can open it, watch the stream and
 * take over. The only difference is that nobody is holding the socket at
 * dispatch time, so the outbound stream starts on a sink and is picked up by
 * whichever client subscribes to the session afterwards.
 *
 * The account is settled by the org policy engine, never here: an automation
 * may name a profile, and that name is checked against the org allow-list like
 * any other request. With no name, the resolver picks — which is what makes an
 * automation follow quota fallback for free.
 */

import { randomUUID } from 'node:crypto';

import type { LLMProvider, RealtimeClientConnection } from '@/shared/types.js';

import type { PromptAgentInput, PromptAgentResult } from '../automations.types.js';

/** Mirrors the provider runtime signature every spawn function shares. */
export type ProviderSpawnFn = (
  command: string,
  options: Record<string, unknown>,
  writer: unknown,
) => Promise<unknown>;

/** The slice of the org policy engine a spawn needs. */
export interface AutomationPolicyGateway {
  assertProfileAllowed(projectPath: string | null | undefined, profileId: string): void;
  resolveProfileForSpawn(
    projectPath?: string | null,
    options?: { provider?: LLMProvider; sessionId?: string | null },
  ): Promise<{ profileId: string; fallback?: { reason: string } }>;
  listAllowedProfiles(
    projectPath?: string | null,
    options?: { provider?: LLMProvider },
  ): { profiles: unknown[]; policyManaged: boolean };
}

export interface AutomationRunHandle {
  writer: unknown;
}

export interface AutomationRunRegistryGateway {
  startRun(input: {
    appSessionId: string;
    provider: LLMProvider;
    providerSessionId: string | null;
    connection: RealtimeClientConnection;
    userId: string | number | null;
  }): AutomationRunHandle | null;
  completeRunIfCurrent(run: AutomationRunHandle, options: { exitCode: number }): void;
}

export interface AutomationSpawnDeps {
  policy: AutomationPolicyGateway;
  registry: AutomationRunRegistryGateway;
  createSession(input: {
    sessionId: string;
    provider: LLMProvider;
    projectPath: string;
    profileId: string | null;
    worktreePath: string | null;
    worktreeBranch: string | null;
  }): void;
  spawnFns: Partial<Record<LLMProvider, ProviderSpawnFn>>;
}

/**
 * Outbound sink for a run nobody is subscribed to yet.
 *
 * `readyState` is deliberately not the open state: the registry buffers every
 * event for replay regardless, and a socket that reports itself open while
 * discarding writes would be a lie the writer could act on.
 */
const HEADLESS_CONNECTION: RealtimeClientConnection = {
  readyState: 3,
  send: () => {},
};

/** Decides which account the run uses, honouring the org allow-list either way. */
async function resolveProfile(
  deps: AutomationSpawnDeps,
  input: PromptAgentInput,
  sessionId: string,
): Promise<string | null> {
  if (input.requestedProfileId) {
    // Throws `OrgPolicyError` when the org does not allow it — an automation
    // must never be a way around a policy a person would be refused by.
    deps.policy.assertProfileAllowed(input.projectPath, input.requestedProfileId);
    return input.requestedProfileId;
  }

  const allowed = deps.policy.listAllowedProfiles(input.projectPath, { provider: input.provider });
  if (allowed.profiles.length === 0 && !allowed.policyManaged) {
    // Installation with no accounts and no policies: nothing to enforce, and
    // the runtime keeps its own config directory (upstream behaviour).
    return null;
  }

  const selection = await deps.policy.resolveProfileForSpawn(input.projectPath, {
    provider: input.provider,
    sessionId,
  });
  if (selection.fallback) {
    console.warn('[automations] spawning on a fallback account', {
      sessionId,
      profileId: selection.profileId,
      reason: selection.fallback.reason,
    });
  }
  return selection.profileId;
}

/**
 * Creates the session and dispatches the run.
 *
 * Resolves as soon as the runtime has been handed the prompt — not when the
 * agent finishes. An agent run lasts minutes; the automation's history records
 * that the work was started (and on which session), and the run's own outcome
 * belongs to the session, where it is already visible. Awaiting it here would
 * block the tick and make a retry re-prompt an agent that is halfway through.
 */
export function createAutomationSpawnGateway(deps: AutomationSpawnDeps) {
  return {
    async promptAgent(input: PromptAgentInput): Promise<PromptAgentResult> {
      const spawnFn = deps.spawnFns[input.provider];
      if (!spawnFn) {
        throw new Error(`Provider "${input.provider}" is not available for automations`);
      }

      const sessionId = randomUUID();
      const profileId = await resolveProfile(deps, input, sessionId);

      deps.createSession({
        sessionId,
        provider: input.provider,
        projectPath: input.projectPath,
        profileId,
        worktreePath: input.worktreePath,
        worktreeBranch: input.worktreeBranch,
      });

      const run = deps.registry.startRun({
        appSessionId: sessionId,
        provider: input.provider,
        providerSessionId: null,
        connection: HEADLESS_CONNECTION,
        userId: null,
      });
      if (!run) {
        throw new Error(`Session "${sessionId}" already has a run in progress`);
      }

      const options: Record<string, unknown> = {
        sessionId: undefined,
        resume: false,
        cwd: input.worktreePath ?? input.projectPath,
        projectPath: input.projectPath,
        profileId,
      };

      void spawnFn(input.prompt, options, run.writer)
        .catch((error: unknown) => {
          console.error('[automations] a spawned run failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          // Same safety net the chat gateway uses: a runtime that ends without
          // its terminal `complete` would leave the session "processing" forever.
          deps.registry.completeRunIfCurrent(run, { exitCode: 1 });
        });

      return { sessionId, profileId };
    },
  };
}
