import { projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type ToggleProjectNotifyResult = {
  notifyEnabled: boolean;
};

function normalizeProjectId(projectId: string): string {
  return projectId.trim();
}

/**
 * Flips `projects.notifyEnabled` for one project and returns the new state.
 */
export function toggleProjectNotify(projectId: string): ToggleProjectNotifyResult {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    throw new AppError('projectId is required', {
      code: 'PROJECT_ID_REQUIRED',
      statusCode: 400,
    });
  }

  const project = projectsDb.getProjectById(normalizedProjectId);
  if (!project) {
    throw new AppError('Project not found', {
      code: 'PROJECT_NOT_FOUND',
      statusCode: 404,
    });
  }

  const nextNotifyEnabledState = !Boolean(project.notifyEnabled);
  projectsDb.updateProjectNotifyEnabledById(normalizedProjectId, nextNotifyEnabledState);

  return { notifyEnabled: nextNotifyEnabledState };
}
