/**
 * MCP UTILITIES API ROUTES
 * ========================
 *
 * API endpoints for MCP server detection and configuration utilities.
 * These endpoints expose centralized MCP detection functionality.
 */

import express from 'express';

import { projectsDb } from '../modules/database/index.js';
import { detectTaskMasterMCPServer } from '../utils/mcp-detector.js';

const router = express.Router();

/**
 * GET /api/mcp-utils/taskmaster-server?projectId=<id>
 * Check if TaskMaster MCP server is configured. With `projectId`, the
 * project's own `.mcp.json` is considered too.
 */
router.get('/taskmaster-server', async (req, res) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
        const projectPath = projectId ? projectsDb.getProjectPathById(projectId) : null;
        const result = await detectTaskMasterMCPServer(projectPath ?? undefined);
        res.json(result);
    } catch (error) {
        console.error('TaskMaster MCP detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster MCP server',
            message: error.message
        });
    }
});

export default router;
