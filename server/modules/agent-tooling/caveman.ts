/**
 * Caveman response-compression mode for Claude Code sessions.
 *
 * The caveman plugin resolves its intensity from `CAVEMAN_DEFAULT_MODE` ahead of
 * its own config file and built-in default, so injecting that one variable into
 * a session's spawn environment is enough to scope the mode to a single session.
 * That is why this knob can be per-session while the RTK one cannot: caveman
 * reads an env var, RTK reads a hook entry from the profile's `settings.json`,
 * which every session of that profile shares.
 *
 * `off` is a first-class mode rather than "don't inject": the plugin treats it
 * as an explicit instruction to skip activation, which also lets a session
 * override a profile default of `full` back down to nothing.
 */

/**
 * Intensity levels exposed by this app, in increasing order of compression.
 *
 * The plugin also accepts `wenyan-*` variants (classical Chinese); they are
 * deliberately not surfaced here — a UI toggle that silently switches the
 * response language is a different feature from compressing it.
 */
export const CAVEMAN_MODES = ['off', 'lite', 'full', 'ultra'] as const;

export type CavemanMode = (typeof CAVEMAN_MODES)[number];

/** Mode assumed when neither the session nor its profile has an opinion. */
export const DEFAULT_CAVEMAN_MODE: CavemanMode = 'off';

/** Narrows an untrusted value to a supported mode. */
export function isCavemanMode(value: unknown): value is CavemanMode {
  return typeof value === 'string' && (CAVEMAN_MODES as readonly string[]).includes(value);
}

/**
 * Normalizes an untrusted value to a mode, or `null` when it is not one.
 *
 * Returning `null` rather than falling back to a default keeps "the caller sent
 * garbage" distinguishable from "the caller asked for the default", which the
 * REST layer needs in order to reject bad input instead of silently storing
 * something the user did not choose.
 */
export function normalizeCavemanMode(value: unknown): CavemanMode | null {
  if (value === null || value === undefined) {
    return null;
  }
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isCavemanMode(candidate) ? candidate : null;
}

/**
 * Resolves the effective mode for a session from the session override and its
 * profile default, in that order of precedence.
 *
 * Use this for display. For dispatch, prefer `resolveExplicitCavemanMode` —
 * see the note there about not overriding the plugin's own configuration.
 */
export function resolveCavemanMode(
  sessionMode?: string | null,
  profileMode?: string | null,
): CavemanMode {
  return (
    normalizeCavemanMode(sessionMode) ??
    normalizeCavemanMode(profileMode) ??
    DEFAULT_CAVEMAN_MODE
  );
}

/**
 * Same resolution, but `null` when neither level was ever configured here.
 *
 * The distinction matters at dispatch: the plugin has its own config file and
 * its own built-in default, and `CAVEMAN_DEFAULT_MODE` outranks both. Injecting
 * a computed default would silently override the choice of a user who already
 * configured caveman outside this app, so a session with nothing set here must
 * inject nothing at all and let the plugin decide for itself.
 */
export function resolveExplicitCavemanMode(
  sessionMode?: string | null,
  profileMode?: string | null,
): CavemanMode | null {
  return normalizeCavemanMode(sessionMode) ?? normalizeCavemanMode(profileMode);
}

/**
 * Environment that pins the caveman plugin to `mode` for one session.
 *
 * Always emits the variable, including for `off` — an empty result would let a
 * `CAVEMAN_DEFAULT_MODE` inherited from the server process leak into the
 * session and defeat an explicit "off".
 */
export function resolveCavemanEnv(mode: CavemanMode): Record<string, string> {
  return { CAVEMAN_DEFAULT_MODE: mode };
}
