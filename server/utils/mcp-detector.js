/**
 * MCP SERVER DETECTION UTILITY
 * ============================
 *
 * Centralized utility for detecting MCP server configurations.
 * Used across TaskMaster integration and other MCP-dependent features.
 */

import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

function isTaskMasterServer([name, config]) {
    return name === 'task-master-ai' ||
        name.includes('task-master') ||
        Boolean(config && config.command && config.command.includes('task-master'));
}

function findTaskMasterServer(mcpServers, scope, extra = {}) {
    if (!mcpServers || typeof mcpServers !== 'object') {
        return null;
    }
    const serverEntry = Object.entries(mcpServers).find(isTaskMasterServer);
    if (!serverEntry) {
        return null;
    }
    const [name, config] = serverEntry;
    return {
        name,
        scope,
        config,
        type: config.command ? 'stdio' : (config.url ? 'http' : 'unknown'),
        ...extra
    };
}

/**
 * Check if task-master-ai MCP server is configured.
 * Reads the user-level Claude configuration files and, when `projectPath` is
 * given, the project's own `.mcp.json` (what `task-master init --rules claude`
 * writes) — that file never shows up in the user-level configs, so without it
 * every project initialized from the CLI reported "MCP not configured".
 * @param {string} [projectPath] - Absolute project directory to check for a local .mcp.json
 * @returns {Promise<Object>} MCP detection result
 */
export async function detectTaskMasterMCPServer(projectPath) {
    try {
        const homeDir = os.homedir();
        const configSources = [
            { filepath: path.join(homeDir, '.claude.json'), scope: 'user' },
            { filepath: path.join(homeDir, '.claude', 'settings.json'), scope: 'user' }
        ];
        if (projectPath) {
            configSources.unshift({ filepath: path.join(projectPath, '.mcp.json'), scope: 'project' });
        }

        let taskMasterServer = null;
        let hasConfig = false;
        let configPath = null;
        const availableServers = [];

        for (const { filepath, scope } of configSources) {
            let configData;
            try {
                configData = JSON.parse(await fsPromises.readFile(filepath, 'utf8'));
            } catch {
                // File doesn't exist or is not valid JSON, try next
                continue;
            }
            hasConfig = true;
            configPath = configPath ?? filepath;

            if (configData.mcpServers) {
                availableServers.push(...Object.keys(configData.mcpServers).map(name => `${scope}:${name}`));
            }
            taskMasterServer = taskMasterServer ?? findTaskMasterServer(configData.mcpServers, scope);

            // Claude's per-project MCP servers live under `projects[<path>]`.
            if (configData.projects) {
                for (const [localProjectPath, projectConfig] of Object.entries(configData.projects)) {
                    if (projectConfig.mcpServers) {
                        availableServers.push(...Object.keys(projectConfig.mcpServers).map(name => `local:${name}`));
                    }
                    taskMasterServer = taskMasterServer
                        ?? findTaskMasterServer(projectConfig.mcpServers, 'local', { projectPath: localProjectPath });
                }
            }

            if (taskMasterServer) {
                break;
            }
        }

        if (!hasConfig) {
            return {
                hasMCPServer: false,
                reason: 'No Claude configuration file found',
                hasConfig: false
            };
        }

        if (!taskMasterServer) {
            return {
                hasMCPServer: false,
                reason: 'task-master-ai not found in configured MCP servers',
                hasConfig: true,
                configPath,
                availableServers
            };
        }

        const isValid = !!(taskMasterServer.config &&
                         (taskMasterServer.config.command || taskMasterServer.config.url));
        const hasEnvVars = !!(taskMasterServer.config &&
                            taskMasterServer.config.env &&
                            Object.keys(taskMasterServer.config.env).length > 0);

        return {
            hasMCPServer: true,
            isConfigured: isValid,
            hasApiKeys: hasEnvVars,
            scope: taskMasterServer.scope,
            config: {
                command: taskMasterServer.config?.command,
                args: taskMasterServer.config?.args || [],
                url: taskMasterServer.config?.url,
                envVars: hasEnvVars ? Object.keys(taskMasterServer.config.env) : [],
                type: taskMasterServer.type
            }
        };
    } catch (error) {
        console.error('Error detecting MCP server config:', error);
        return {
            hasMCPServer: false,
            reason: `Error checking MCP config: ${error.message}`,
            hasConfig: false
        };
    }
}
