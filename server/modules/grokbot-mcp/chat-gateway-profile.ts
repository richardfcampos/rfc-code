/**
 * Account choice and error shape for turns started by the chat gateway.
 *
 * A turn sent by the bot must land on the same account a turn typed in the
 * composer would, so the decision mirrors the chat WebSocket's pre-spawn
 * policy check: an explicit profile only has to pass the org allow-list, no
 * choice lets the org resolver pick one (that is what makes quota fallback
 * happen), and an installation with no accounts and no policies keeps the
 * runtime on its own config dir.
 */

import { OrgPolicyError, type OrgPolicyService } from '@/modules/orgs/index.js';
import type { LLMProvider } from '@/shared/types.js';

/** Error carrying the HTTP-like status and stable code the JSON-RPC layer reports. */
export type GatewayError = Error & { status: number; code: string };

export function gatewayError(status: number, code: string, message: string): GatewayError {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Resolves the profile a send runs on (`null` = runtime default) or throws a
 * 403 gateway error carrying the policy's own code when the org refuses it.
 * Anything the policy engine cannot decide propagates — never a silent pass.
 */
export async function decideGatewayProfile(
  policy: OrgPolicyService,
  projectPath: string | null,
  requestedProfileId: string | null,
  provider: LLMProvider,
  sessionId: string,
): Promise<string | null> {
  try {
    if (requestedProfileId) {
      policy.assertProfileAllowed(projectPath, requestedProfileId);
      return requestedProfileId;
    }

    const allowed = policy.listAllowedProfiles(projectPath, { provider });
    if (allowed.profiles.length === 0 && !allowed.policyManaged) {
      return null;
    }

    const selection = await policy.resolveProfileForSpawn(projectPath, { provider, sessionId });
    if (selection.fallback) {
      console.warn('[grokbot-mcp] Spawning on a fallback account', {
        sessionId,
        profileId: selection.profileId,
        reason: selection.fallback.reason,
      });
    }
    return selection.profileId;
  } catch (error) {
    if (error instanceof OrgPolicyError) {
      throw gatewayError(403, error.code, error.reason);
    }
    throw error;
  }
}
