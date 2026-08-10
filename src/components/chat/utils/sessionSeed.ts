// One-shot hand-off used when another surface opens a brand-new chat session
// with the first message already written (today: a collaboration verdict).
//
// It travels as a window event instead of router state or storage on purpose:
// the seed must die with the navigation that carried it. Router state survives
// a reload, so a refresh would re-inject text the user may have already edited
// or deliberately deleted.
//
// The seed only ever fills the composer. Sending stays a human action.

import type { LLMProvider } from '../../../types/app';

export const CHAT_SESSION_SEED_EVENT = 'chat:session-seed';

export type ChatSessionSeed = {
  /** Session already created on the backend; the URL is about to point at it. */
  sessionId: string;
  provider: LLMProvider;
  /** Model id for `provider`, as returned by the provider model catalog. */
  model: string;
  /** Reasoning effort, or `default` to leave the CLI default alone. */
  effort: string;
  /** Text dropped into the composer. Never auto-sent. */
  content: string;
  /** Optional sidebar label until the backend indexes the real title. */
  summary?: string;
};

const isUsableSeed = (value: unknown): value is ChatSessionSeed => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const seed = value as Partial<ChatSessionSeed>;
  return (
    typeof seed.sessionId === 'string' && seed.sessionId.trim().length > 0 &&
    typeof seed.provider === 'string' && seed.provider.length > 0 &&
    typeof seed.model === 'string' &&
    typeof seed.effort === 'string' &&
    typeof seed.content === 'string' && seed.content.length > 0
  );
};

export function dispatchChatSessionSeed(seed: ChatSessionSeed): void {
  window.dispatchEvent(new CustomEvent<ChatSessionSeed>(CHAT_SESSION_SEED_EVENT, { detail: seed }));
}

/** Subscribes to seeds; returns the unsubscribe function. */
export function subscribeToChatSessionSeed(handler: (seed: ChatSessionSeed) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isUsableSeed(detail)) {
      // A malformed seed would half-fill the composer; drop it loudly instead.
      console.warn('Ignoring a malformed chat session seed:', detail);
      return;
    }
    handler(detail);
  };

  window.addEventListener(CHAT_SESSION_SEED_EVENT, listener);
  return () => window.removeEventListener(CHAT_SESSION_SEED_EVENT, listener);
}
