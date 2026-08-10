/**
 * Composition root of the collaboration module: the only place that knows both
 * how a collaboration works and how this application actually talks to a model.
 *
 * Assembling it here and nowhere else is what lets every other file stay
 * ignorant of the rest: the engine takes a runtime as an argument instead of
 * importing one, the service takes profiles as a gateway instead of importing
 * the profiles module, and the adapters that turn all of that into real
 * provider calls live in their own files next door.
 *
 * `configureCollabClaudeRuntime` is re-exported because the server entrypoint
 * owns the `server/claude-sdk.js` import — that file sits outside the module
 * boundaries the backend lint rules enforce — and the module barrel is the only
 * surface the entrypoint is allowed to reach.
 */

import { profilesService } from '@/modules/profiles/index.js';
import type { LLMProvider } from '@/shared/types.js';

import { collabClaudeRuntime } from './collab-claude-runtime.service.js';
import { collabCodexRuntime } from './collab-codex-runtime.service.js';
import { createCollabEngine } from './collab-engine.service.js';
import { collabRepository } from './collab.repository.js';
import type { CollabRuntime } from './collab-runtime.js';
import { createCollabRouter } from './collab.routes.js';
import { createCollabService } from './collab.service.js';
import type { CollabProfileGateway } from './collab.service.js';

export { configureCollabClaudeRuntime } from './collab-claude-runtime.service.js';
export type { CollabClaudeRuntimeDeps } from './collab-claude-runtime.service.js';

/**
 * One adapter per provider, picked per turn: participants carry their own
 * provider, so a single collaboration can put a Claude account and a Codex
 * account on opposite sides of the same argument. Claude is the fallback
 * because it is the only provider whose adapter the entrypoint wires by hand;
 * validation refuses anything not listed here long before a turn runs.
 */
const RUNTIMES: Partial<Record<LLMProvider, CollabRuntime>> = {
  codex: collabCodexRuntime,
};

/**
 * Profiles as a collaboration sees them. A missing profile is an answer, not an
 * exception: participants are stored by id and an account can be deleted while
 * its transcript is still on screen.
 */
const profiles: CollabProfileGateway = {
  find(profileId) {
    try {
      const profile = profilesService.getProfile(profileId);
      return { id: profile.id, name: profile.name, provider: profile.provider };
    } catch {
      return null;
    }
  },
  isAuthenticated(profileId) {
    try {
      return profilesService.getAuthStatus(profileId).authenticated;
    } catch {
      return false;
    }
  },
};

const engine = createCollabEngine({
  runtime: (input) => (RUNTIMES[input.provider] ?? collabClaudeRuntime)(input),
  // Prompts and the final verdict name accounts; a raw uuid would be unreadable
  // in both. The id is only ever a fallback for a profile that has been deleted.
  resolveName: (profileId) => profiles.find(profileId)?.name ?? profileId,
});

const collabServices = createCollabService({ profiles, engine });

/** Collaborations router mounted by the server entrypoint. */
export const collabRoutes = createCollabRouter(collabServices);

/**
 * Closes the runs a restart abandoned.
 *
 * The round loop lives in memory and dies with the process, so a row left in
 * `running` will never advance and the UI would poll it forever. Never throws:
 * a sweep that fails is not a reason to refuse to boot.
 */
export function failOrphanedCollaborations(): number {
  try {
    return collabRepository.failOrphanedRuns();
  } catch (error) {
    console.error('[collab] could not close collaborations orphaned by a restart:', error);
    return 0;
  }
}
