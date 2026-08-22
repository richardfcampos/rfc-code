import { AppError } from '@/shared/utils.js';

/**
 * Raised whenever a profile is refused for a project.
 *
 * Extends `AppError` so the existing REST error handler answers 403 with
 * `{ code: 'ORG_POLICY_DENIED' }` without any route-level branching, and keeps
 * the human reason on a dedicated field so callers on other transports (the
 * WebSocket spawn path, the MCP bridge) can forward it verbatim.
 */
export class OrgPolicyError extends AppError {
  readonly reason: string;

  constructor(reason: string, details?: unknown) {
    super(reason, { code: 'ORG_POLICY_DENIED', statusCode: 403, details });
    this.name = 'OrgPolicyError';
    this.reason = reason;
  }
}
