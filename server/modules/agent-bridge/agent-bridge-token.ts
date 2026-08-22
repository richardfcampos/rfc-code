/**
 * Bearer tokens that let one agent process drive the bridge on behalf of the
 * chat session it was spawned for.
 *
 * Agent processes never hold a user JWT, so the bridge authenticates them with
 * a signed statement of scope instead: "this caller is session X, working on
 * project Y". The token is a detached HMAC over a JSON payload — deliberately
 * not a JWT, because nothing here should ever be accepted by the JWT auth
 * middleware, and nothing the JWT middleware issues should ever be accepted
 * here. The secret is derived from the installation secret through a labelled
 * HMAC, which makes the two token families cryptographically disjoint even
 * though they share a root.
 *
 * Everything in this file is pure: no clock beyond the caller-supplied `iat`,
 * no database, no environment. Tokens carry no expiry — a bridge token is
 * useful exactly as long as its session exists, and that liveness check is the
 * caller's job (a signature alone must never be enough to act).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bumped only if the payload shape changes; older tokens then fail to verify. */
const TOKEN_VERSION = 'v1';

/** Domain separation label: keeps bridge tokens off the JWT secret itself. */
const SECRET_LABEL = 'cloudcli:agent-bridge:v1';

export interface AgentBridgeTokenPayload {
  /** Chat session the agent runs in; the bridge rejects calls once it is gone. */
  sessionId: string;
  /** Absolute project path, used for org policy questions. Null when unknown. */
  projectPath: string | null;
  /** Project key the task board is filtered by; scopes every task tool. */
  projectName: string;
  /** Issued-at, seconds since the epoch. Informational: tokens do not expire. */
  iat: number;
}

export type AgentBridgeTokenInput = Omit<AgentBridgeTokenPayload, 'iat'> & { iat?: number };

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Derives the bridge signing key from the installation's root secret.
 *
 * Exported so the composition root can bind it once; tests build their own.
 */
export function deriveAgentBridgeSecret(rootSecret: string): Buffer {
  if (typeof rootSecret !== 'string' || rootSecret.length === 0) {
    throw new Error('Agent bridge secret derivation requires a non-empty root secret.');
  }
  return createHmac('sha256', rootSecret).update(SECRET_LABEL).digest();
}

function sign(signingInput: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

export function signAgentBridgeToken(payload: AgentBridgeTokenInput, secret: Buffer): string {
  const sessionId = payload.sessionId?.trim();
  const projectName = payload.projectName?.trim();
  if (!sessionId || !projectName) {
    throw new Error('Agent bridge tokens require a sessionId and a projectName.');
  }

  const body: AgentBridgeTokenPayload = {
    sessionId,
    projectPath: payload.projectPath ?? null,
    projectName,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
  };

  const signingInput = `${TOKEN_VERSION}.${encode(JSON.stringify(body))}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

function parsePayload(encoded: string): AgentBridgeTokenPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId.trim() : '';
  const projectName = typeof candidate.projectName === 'string' ? candidate.projectName.trim() : '';
  const projectPath = typeof candidate.projectPath === 'string' && candidate.projectPath.trim()
    ? candidate.projectPath.trim()
    : null;
  const iat = typeof candidate.iat === 'number' && Number.isFinite(candidate.iat) ? candidate.iat : null;

  if (!sessionId || !projectName || iat === null) {
    return null;
  }

  return { sessionId, projectPath, projectName, iat };
}

/**
 * Verifies a bridge token and returns its payload, or null for anything that
 * is not a valid, untampered token signed by this installation.
 *
 * A returned payload proves origin and integrity only. Callers still have to
 * check that `sessionId` names a live session before acting on it.
 */
export function verifyAgentBridgeToken(token: unknown, secret: Buffer): AgentBridgeTokenPayload | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [version, encodedPayload, signature] = parts as [string, string, string];
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    return null;
  }

  const expected = Buffer.from(sign(`${version}.${encodedPayload}`, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on length mismatch, which is itself a leak-free
  // "not equal" answer — check the length first and keep the comparison
  // constant-time for the (only interesting) same-length case.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  return parsePayload(encodedPayload);
}

/** Extracts the credential from an `Authorization: Bearer <token>` header. */
export function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
