/**
 * PREVIEW API ROUTES
 * ==================
 *
 * Boots a project's dev server for hands-on UAT from the Review Cockpit and
 * hands back a tailnet-reachable URL. Per-project boot recipes live in the
 * preview_configs table; process lifecycle lives in utils/preview-runner.js.
 */

import fs from 'fs';
import path from 'path';

import express from 'express';

import { previewConfigsDb, projectsDb } from '../modules/database/index.js';
import {
  getPreviewStatus,
  resolveBindHost,
  startPreview,
  stopPreview,
} from '../utils/preview-runner.js';

const router = express.Router();

async function resolveProjectPathFromId(projectId) {
  if (!projectId) {
    return null;
  }
  return projectsDb.getProjectPathById(projectId);
}

/**
 * Callers that already hold the repository path (the Review Center works from
 * worktree coordinates, not project ids) pass it explicitly; everyone else
 * resolves the `:projectId` route param through the projects table.
 */
async function resolveProjectPath(req) {
  const explicitPath =
    typeof req.body?.projectPath === 'string'
      ? req.body.projectPath.trim()
      : typeof req.query?.projectPath === 'string'
        ? req.query.projectPath.trim()
        : '';

  if (explicitPath) {
    return fs.existsSync(explicitPath) ? explicitPath : null;
  }

  return resolveProjectPathFromId(req.params.projectId);
}

/**
 * Suggest a boot recipe by sniffing the project's package.json. Only a
 * pre-fill for the config form — the user confirms before anything runs.
 */
export function detectPreviewCommand(projectPath) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'),
    );
    const scripts = packageJson.scripts ?? {};
    const dependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });

    const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
    if (!scriptName) {
      return null;
    }

    let command = `npm run ${scriptName}`;
    if (dependencyNames.includes('vite')) {
      command += ' -- --host $HOST --port $PORT';
    } else if (dependencyNames.includes('next')) {
      command += ' -- -H $HOST -p $PORT';
    }
    // Other stacks get PORT/HOST as env vars, which most dev servers honor.

    return { command, setupCommand: 'npm install' };
  } catch {
    return null;
  }
}

/**
 * The directory a preview runs in: an explicit worktree passed by the client,
 * validated to exist, or the project root.
 */
function resolveCwd(projectPath, cwdValue) {
  const cwd = typeof cwdValue === 'string' ? cwdValue.trim() : '';
  if (!cwd) {
    return projectPath;
  }
  if (!fs.existsSync(cwd)) {
    return null;
  }
  return cwd;
}

/** GET /api/preview/config/:projectId — stored config + auto-detect suggestion */
router.get('/config/:projectId', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const config = previewConfigsDb.getByProjectPath(projectPath);
    res.json({
      config,
      suggested: config ? null : detectPreviewCommand(projectPath),
      defaultBindHost: resolveBindHost(),
    });
  } catch (error) {
    console.error('[Preview] Failed to read config:', error);
    res.status(500).json({ error: error.message });
  }
});

/** PUT /api/preview/config/:projectId — save the boot recipe */
router.put('/config/:projectId', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { command, setupCommand, bindHost, port } = req.body ?? {};
    if (typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({ error: 'command is required' });
    }

    // The tailnet/LAN boundary is the preview's only auth — a wildcard bind
    // would expose it on the host's public interface.
    const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '*', '[::]']);
    if (typeof bindHost === 'string' && WILDCARD_HOSTS.has(bindHost.trim())) {
      return res.status(400).json({ error: 'bindHost cannot be a wildcard address (0.0.0.0/::)' });
    }

    const parsedPort = port == null || port === '' ? null : Number(port);
    if (parsedPort !== null && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
      return res.status(400).json({ error: 'port must be an integer between 1 and 65535' });
    }

    previewConfigsDb.upsert({
      projectPath,
      command,
      setupCommand: typeof setupCommand === 'string' ? setupCommand : null,
      bindHost: typeof bindHost === 'string' ? bindHost : null,
      port: parsedPort,
    });

    res.json({ config: previewConfigsDb.getByProjectPath(projectPath) });
  } catch (error) {
    console.error('[Preview] Failed to save config:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/preview/start/:projectId { cwd? } — boot and return a snapshot */
router.post('/start/:projectId', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const config = previewConfigsDb.getByProjectPath(projectPath);
    if (!config) {
      return res.status(400).json({ error: 'No preview config for this project — save one first', code: 'NO_CONFIG' });
    }

    const cwd = resolveCwd(projectPath, req.body?.cwd);
    if (!cwd) {
      return res.status(400).json({ error: 'cwd does not exist' });
    }

    // Boot can take minutes (npm install). Respond with an early snapshot and
    // let the client's status poll follow the state machine; startPreview
    // never rejects, so the unawaited branch cannot produce an unhandled
    // rejection.
    const bootPromise = startPreview({
      projectPath,
      cwd,
      command: config.command,
      setupCommand: config.setup_command,
      bindHost: config.bind_host,
      port: config.port,
    });
    const earlySnapshot = new Promise((resolve) =>
      setTimeout(() => resolve(getPreviewStatus(cwd)), 1500),
    );

    res.json(await Promise.race([bootPromise, earlySnapshot]));
  } catch (error) {
    console.error('[Preview] Failed to start preview:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/preview/status/:projectId?cwd= — poll during boot */
router.get('/status/:projectId', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const cwd = resolveCwd(projectPath, req.query.cwd) ?? projectPath;
    res.json(getPreviewStatus(cwd));
  } catch (error) {
    console.error('[Preview] Failed to read status:', error);
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/preview/stop/:projectId { cwd? } */
router.post('/stop/:projectId', async (req, res) => {
  try {
    const projectPath = await resolveProjectPath(req);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const cwd = resolveCwd(projectPath, req.body?.cwd) ?? projectPath;
    res.json(stopPreview(cwd));
  } catch (error) {
    console.error('[Preview] Failed to stop preview:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
