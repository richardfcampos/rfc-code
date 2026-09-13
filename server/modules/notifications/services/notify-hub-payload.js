/**
 * notify-hub message builder.
 *
 * Pure formatting for the phone push: no DB, no network, no env reads — the
 * channel resolves project + config and hands both in, so every wording rule
 * here is testable with a frozen clock. Text is PT-BR on purpose: it mirrors
 * the notify-hook the operator already receives, and the server has no notion
 * of the user's UI language.
 */

import path from 'node:path';

const MAX_MESSAGE_CHARS = 500;
const MAX_ERROR_CHARS = 200;
const MAX_SESSION_NAME_CHARS = 80;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// notify-hub routes on these coarse event names, so an aborted run is still an
// "end" — the distinction lives in the title, not in the routing key.
const METADATA_EVENT_BY_CODE = {
  'run.stopped': 'end',
  'run.failed': 'failed',
  'permission.required': 'needs-input',
};

// Elevated priority is for things that need the operator now: a failure or an
// approval still blocking the run. A clean finish is informational.
const HIGH_PRIORITY_CODES = new Set(['run.failed', 'permission.required']);

// An unusable timezone is a config mistake, not a per-event condition: warn the
// first time and stay quiet afterwards so one bad setting cannot flood the log.
let hasWarnedAboutTimezone = false;

/** Collapses whitespace and hard-caps a string, keeping the cap inclusive of the ellipsis. */
function capText(value, maxChars) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

/**
 * Builds the HH:MM formatter for the configured zone. A zone that `Intl`
 * rejects (typo, stale name) must never cost a notification, so it degrades to
 * the server's local zone instead of throwing.
 */
function createTimeFormatter(timezone) {
  const options = { hour: '2-digit', minute: '2-digit', hour12: false };
  const zone = typeof timezone === 'string' ? timezone.trim() : '';
  if (zone) {
    try {
      return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: zone });
    } catch {
      if (!hasWarnedAboutTimezone) {
        hasWarnedAboutTimezone = true;
        console.warn(`[notify-hub] fuso horário inválido ("${zone}"); usando o fuso do servidor`);
      }
    }
  }
  return new Intl.DateTimeFormat('pt-BR', options);
}

/** Formats an epoch-ms instant as HH:MM in the given zone (server zone on fallback). */
function formatTime(timestampMs, timezone) {
  return createTimeFormatter(timezone).format(new Date(timestampMs));
}

/** Human duration: `<1min`, `12min`, `1h 04min`. Negative spans (clock skew) read as `<1min`. */
function formatDuration(durationMs) {
  const elapsed = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  if (elapsed < MINUTE_MS) {
    return '<1min';
  }
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(elapsed / HOUR_MS);
  const remainderMinutes = minutes - hours * 60;
  return `${hours}h ${String(remainderMinutes).padStart(2, '0')}min`;
}

/** The operator's own name for the project wins; otherwise the folder name. */
function resolveProjectName(project) {
  const customName = typeof project?.custom_project_name === 'string' ? project.custom_project_name.trim() : '';
  if (customName) {
    return customName;
  }
  const projectPath = typeof project?.project_path === 'string' ? project.project_path : '';
  return path.basename(projectPath) || projectPath || 'projeto';
}

function buildTitle(code, meta, projectName) {
  if (code === 'run.failed') {
    return `❌ ${projectName} — falhou`;
  }
  if (code === 'permission.required') {
    return `🙋 ${projectName} — precisa de você`;
  }
  if (meta?.stopReason === 'aborted') {
    return `⏹ ${projectName} — interrompido`;
  }
  return `✅ ${projectName} — concluído`;
}

/**
 * The time line: the event instant is always the end; `startedAt` (when the
 * provider knew it) turns it into a span so the push says how long it ran.
 */
function buildTimeLine(meta, timezone, now) {
  const endLabel = formatTime(now, timezone);
  const startedAt = Number(meta?.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return `Fim ${endLabel}`;
  }
  const startLabel = formatTime(startedAt, timezone);
  return `Início ${startLabel} · Fim ${endLabel} (${formatDuration(now - startedAt)})`;
}

function buildDetailLine(code, meta) {
  if (code === 'run.failed') {
    const error = capText(meta?.error, MAX_ERROR_CHARS);
    return error ? `Erro: ${error}` : null;
  }
  if (code === 'permission.required') {
    const toolName = capText(meta?.toolName, MAX_SESSION_NAME_CHARS);
    return toolName ? `Ferramenta "${toolName}" aguarda aprovação` : 'Uma ferramenta aguarda aprovação';
  }
  return null;
}

/**
 * Builds the notify-hub wire body for one event. `now` is injected so the
 * caller (and the tests) control the clock; `timezone` comes from the resolved
 * hub config, not from env.
 */
function buildNotifyHubRequestBody({ event, project, timezone = null, now = Date.now() } = {}) {
  const code = event?.code;
  const meta = event?.meta || {};
  const projectName = resolveProjectName(project);

  const sessionName = capText(meta.sessionName, MAX_SESSION_NAME_CHARS);
  const lines = [buildTimeLine(meta, timezone, now)];
  if (sessionName) {
    lines.push(`Sessão: ${sessionName}`);
  }
  const detailLine = buildDetailLine(code, meta);
  if (detailLine) {
    lines.push(detailLine);
  }

  const message = lines.join('\n');
  return {
    title: buildTitle(code, meta, projectName),
    message: message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : message,
    priority: HIGH_PRIORITY_CODES.has(code) ? 'high' : 'default',
    metadata: {
      event: METADATA_EVENT_BY_CODE[code] || 'end',
      project: projectName,
      projectPath: project?.project_path || null,
      provider: event?.provider || null,
      sessionId: event?.sessionId || null,
      timestamp: new Date(now).toISOString(),
    },
  };
}

export { buildNotifyHubRequestBody, formatDuration, formatTime, resolveProjectName };
