import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

/**
 * Lifecycle of one handoff message.
 *
 * `delivered` means the recipient session pulled the message through the agent
 * bridge — there is no push into a running agent's context, so "the recipient
 * asked for its inbox" is the only honest delivery signal this system has.
 */
export type AgentMessageState = 'queued' | 'delivered' | 'acknowledged' | 'answered' | 'failed';

export type AgentMessageRow = {
  message_id: string;
  from_session_id: string;
  to_session_id: string;
  subject: string;
  body: string;
  state: AgentMessageState;
  reply_to_message_id: string | null;
  detail: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateAgentMessageInput = {
  fromSessionId: string;
  toSessionId: string;
  subject: string;
  body: string;
  replyToMessageId?: string | null;
};

/** Which side of a session's mailbox a listing reads. */
export type AgentMessageBox = 'inbox' | 'outbox';

export type ListAgentMessagesFilter = {
  box: AgentMessageBox;
  state?: AgentMessageState;
};

const MESSAGE_COLUMNS =
  'message_id, from_session_id, to_session_id, subject, body, state, reply_to_message_id, detail, created_at, updated_at';

function getMessageById(messageId: string): AgentMessageRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM agent_messages WHERE message_id = ?`)
    .get(messageId) as AgentMessageRow | undefined;
  return row ?? null;
}

export const agentMessagesDb = {
  create(input: CreateAgentMessageInput): AgentMessageRow {
    const db = getConnection();
    const messageId = randomUUID();
    db.prepare(
      `INSERT INTO agent_messages (
         message_id, from_session_id, to_session_id, subject, body, state, reply_to_message_id
       ) VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(
      messageId,
      input.fromSessionId,
      input.toSessionId,
      input.subject,
      input.body,
      input.replyToMessageId ?? null,
    );
    return getMessageById(messageId) as AgentMessageRow;
  },

  get(messageId: string): AgentMessageRow | null {
    return getMessageById(messageId);
  },

  /**
   * One session's mailbox, oldest first.
   *
   * Oldest-first is deliberate: an agent works its inbox as a queue, and the
   * message that has been waiting longest is the one to answer first.
   */
  listForSession(sessionId: string, filter: ListAgentMessagesFilter): AgentMessageRow[] {
    const db = getConnection();
    const sessionColumn = filter.box === 'inbox' ? 'to_session_id' : 'from_session_id';
    const stateClause = filter.state ? ' AND state = ?' : '';
    const params = filter.state ? [sessionId, filter.state] : [sessionId];

    return db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM agent_messages
         WHERE ${sessionColumn} = ?${stateClause}
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(...params) as AgentMessageRow[];
  },

  /** Messages that reply to `messageId`, oldest first. */
  listReplies(messageId: string): AgentMessageRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM agent_messages
         WHERE reply_to_message_id = ?
         ORDER BY datetime(created_at) ASC, rowid ASC`,
      )
      .all(messageId) as AgentMessageRow[];
  },

  /**
   * Moves a message to `state`, but only from one of `fromStates`.
   *
   * The guard is in the WHERE clause rather than in a read-then-write pair so
   * two agents racing on the same message cannot both observe `queued` and both
   * "win" the transition: the loser updates zero rows and gets null back.
   */
  transition(
    messageId: string,
    state: AgentMessageState,
    fromStates: readonly AgentMessageState[],
    detail?: string | null,
  ): AgentMessageRow | null {
    if (fromStates.length === 0) {
      return null;
    }

    const db = getConnection();
    const placeholders = fromStates.map(() => '?').join(', ');
    const changes = db
      .prepare(
        `UPDATE agent_messages
         SET state = ?, detail = ?, updated_at = CURRENT_TIMESTAMP
         WHERE message_id = ? AND state IN (${placeholders})`,
      )
      .run(state, detail ?? null, messageId, ...fromStates).changes;

    return changes > 0 ? getMessageById(messageId) : null;
  },

  /** Drops a session's messages on both sides — used when its history is deleted. */
  deleteBySession(sessionId: string): number {
    if (!sessionId) {
      return 0;
    }

    return getConnection()
      .prepare('DELETE FROM agent_messages WHERE from_session_id = ? OR to_session_id = ?')
      .run(sessionId, sessionId).changes;
  },
};
