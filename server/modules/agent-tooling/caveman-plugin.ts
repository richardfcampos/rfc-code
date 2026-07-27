/**
 * Registers the caveman plugin inside a profile's config directory.
 *
 * `CAVEMAN_DEFAULT_MODE` only does something if the plugin is actually enabled
 * for the config dir the session runs against — the variable sets the intensity,
 * the plugin supplies the hook that reads it. Setting a level without this
 * registration produces a switch that appears to work and changes nothing.
 *
 * The plugin itself is not copied per profile. Claude Code records an absolute
 * `installPath` in `installed_plugins.json`, so every profile points at the one
 * copy baked into the image, and enabling the feature costs two small JSON
 * files rather than a duplicated checkout per account.
 */

import fs from 'node:fs';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';
import { readSettings, resolveSettingsPath, updateSettings } from '@/modules/agent-tooling/profile-settings.js';

/** Key Claude Code uses for this plugin: `<plugin>@<marketplace>`. */
export const CAVEMAN_PLUGIN_KEY = 'caveman@caveman';

const MARKETPLACE_NAME = 'caveman';
const MARKETPLACE_REPO = 'JuliusBrussee/caveman';

/**
 * Where the image put the plugin. Overridable so tests (and anyone running the
 * server outside the container) can point at a checkout of their own.
 */
export function resolveCavemanPluginPath(): string {
  return process.env.CAVEMAN_PLUGIN_PATH || '/opt/claude-plugins/caveman';
}

export function isCavemanPluginAvailable(): boolean {
  return fs.existsSync(path.join(resolveCavemanPluginPath(), '.claude-plugin', 'plugin.json'));
}

function installedPluginsPath(profileDir: string): string {
  return path.join(profileDir, 'plugins', 'installed_plugins.json');
}

/**
 * Makes the plugin visible and enabled for one profile.
 *
 * Merges into whatever is already registered instead of replacing the files, so
 * a profile that has other plugins keeps them.
 */
export function enableCavemanPlugin(profileDir: string): void {
  const pluginPath = resolveCavemanPluginPath();
  if (!isCavemanPluginAvailable()) {
    throw new AppError(
      `The caveman plugin is not installed at ${pluginPath}, so setting a compression level would have no effect.`,
      { code: 'CAVEMAN_PLUGIN_MISSING', statusCode: 503 },
    );
  }

  updateSettings(profileDir, (settings) => ({
    ...settings,
    enabledPlugins: { ...settings.enabledPlugins, [CAVEMAN_PLUGIN_KEY]: true },
    extraKnownMarketplaces: {
      ...settings.extraKnownMarketplaces,
      [MARKETPLACE_NAME]: { source: { source: 'github', repo: MARKETPLACE_REPO } },
    },
  }));

  const registryPath = installedPluginsPath(profileDir);
  const registry = readJsonObject(registryPath);
  const plugins = (registry.plugins ?? {}) as Record<string, unknown>;

  writeJson(registryPath, {
    ...registry,
    version: registry.version ?? 2,
    plugins: {
      ...plugins,
      [CAVEMAN_PLUGIN_KEY]: [{ scope: 'user', installPath: pluginPath }],
    },
  });
}

/**
 * Turns the plugin off for one profile without unregistering it.
 *
 * `enabledPlugins[key] = false` is enough to stop the hook from running, and
 * leaving the install entry in place means re-enabling later does not have to
 * re-resolve where the plugin lives.
 */
export function disableCavemanPlugin(profileDir: string): void {
  const settingsPath = resolveSettingsPath(profileDir);
  if (!fs.existsSync(settingsPath)) {
    return;
  }

  updateSettings(profileDir, (settings) => {
    if (!settings.enabledPlugins || !(CAVEMAN_PLUGIN_KEY in settings.enabledPlugins)) {
      return settings;
    }
    return {
      ...settings,
      enabledPlugins: { ...settings.enabledPlugins, [CAVEMAN_PLUGIN_KEY]: false },
    };
  });
}

/** True when this profile has the plugin registered and switched on. */
export function isCavemanPluginEnabled(profileDir: string): boolean {
  const settings = readSettings(resolveSettingsPath(profileDir));
  return settings.enabledPlugins?.[CAVEMAN_PLUGIN_KEY] === true;
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new AppError(`Plugin registry at ${filePath} is not valid JSON, refusing to overwrite it.`, {
      code: 'PLUGIN_REGISTRY_MALFORMED',
      statusCode: 409,
    });
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}
