/**
 * Public surface of the agent tooling module.
 *
 * Covers the two optional add-ons a Claude Code session can run with: caveman
 * (response compression, scoped per session through an env var) and RTK
 * (command rewriting, scoped per profile through a hook in settings.json), plus
 * the shared reader and writer for the `settings.json` they both persist into —
 * which the bundled agent kit registers its own hooks through as well.
 */

export {
  readSettings,
  updateSettings,
  writeSettings,
  type HookEntry,
  type HookMatcher,
  type SettingsShape,
} from '@/modules/agent-tooling/profile-settings.js';

export {
  CAVEMAN_MODES,
  DEFAULT_CAVEMAN_MODE,
  isCavemanMode,
  normalizeCavemanMode,
  resolveCavemanEnv,
  resolveCavemanMode,
  resolveExplicitCavemanMode,
  type CavemanMode,
} from '@/modules/agent-tooling/caveman.js';

export {
  CAVEMAN_PLUGIN_KEY,
  disableCavemanPlugin,
  enableCavemanPlugin,
  isCavemanPluginAvailable,
  isCavemanPluginEnabled,
  resolveCavemanPluginPath,
} from '@/modules/agent-tooling/caveman-plugin.js';

export {
  applyRtkMode,
  buildRtkHookCommand,
  DEFAULT_RTK_MODE,
  isRtkMode,
  normalizeRtkMode,
  readRtkMode,
  RTK_MODES,
  resolveSettingsPath,
  type RtkMode,
} from '@/modules/agent-tooling/rtk-settings.js';
