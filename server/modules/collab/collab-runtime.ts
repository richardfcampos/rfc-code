/**
 * The seam between the collaboration engine and whatever actually talks to a
 * model, plus the one policy that belongs to a single call: how long a turn may
 * take, and which failures are survivable.
 *
 * It lives outside the engine because the engine is a loop over rounds and this
 * is a loop over nothing — a single call with a clock on it. Separating them
 * keeps both readable and lets the engine deal in outcomes instead of
 * exceptions: a turn either produced text or produced a reason, and only the
 * second kind of reason ends the whole collaboration.
 */

import type { LLMProvider } from '@/shared/types.js';

/**
 * What one turn needs to run. `model` and `effort` are the seat's own choices
 * and stay optional: an account that picked neither runs on whatever its CLI
 * defaults to, which is what every collaboration did before seats could choose.
 */
export interface RuntimeCallInput {
  prompt: string;
  profileId: string;
  provider: LLMProvider;
  cwd: string;
  model?: string;
  effort?: string;
}

export type CollabRuntime = (
  input: RuntimeCallInput & { signal?: AbortSignal },
) => Promise<string>;

export interface RuntimeCallResult {
  content: string;
  error: string | null;
  /** True when the failure must end the collaboration rather than one turn. */
  fatal: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Runs one turn under a deadline. The abort signal asks the runtime to stop;
 * the race guarantees we stop waiting even when it does not listen. A timeout
 * is deliberately non-fatal — one slow account should cost a turn, not the run.
 */
export async function callRuntimeWithTimeout(
  runtime: CollabRuntime,
  input: RuntimeCallInput,
  timeoutMs: number,
): Promise<RuntimeCallResult> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      // Settle the race before aborting: a runtime that reacts to the signal
      // synchronously must not be able to slip an answer in past the deadline.
      reject(new Error(`Turn abandoned after ${Math.round(timeoutMs / 1000)}s without an answer.`));
      controller.abort();
    }, timeoutMs);
  });

  try {
    const content = await Promise.race([runtime({ ...input, signal: controller.signal }), expiry]);
    return { content, error: null, fatal: false };
  } catch (error) {
    return { content: '', error: errorMessage(error), fatal: !timedOut };
  } finally {
    clearTimeout(timer);
  }
}
