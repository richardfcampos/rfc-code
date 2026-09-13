import assert from 'node:assert/strict';
import test from 'node:test';

import { projectsDb } from '@/modules/database/index.js';
import { toggleProjectNotify } from '@/modules/projects/services/project-notify.service.js';
import { AppError } from '@/shared/utils.js';

type ProjectRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
  notifyEnabled: number;
};

test('toggleProjectNotify throws when projectId is missing', () => {
  assert.throws(
    () => toggleProjectNotify('   '),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'PROJECT_ID_REQUIRED'
      && error.statusCode === 400,
  );
});

test('toggleProjectNotify throws when project does not exist', () => {
  const originalGetProjectById = projectsDb.getProjectById;
  try {
    projectsDb.getProjectById = () => null;
    assert.throws(
      () => toggleProjectNotify('project-1'),
      (error: unknown) =>
        error instanceof AppError
        && error.code === 'PROJECT_NOT_FOUND'
        && error.statusCode === 404,
    );
  } finally {
    projectsDb.getProjectById = originalGetProjectById;
  }
});

test('toggleProjectNotify flips notify state 0 -> 1 -> 0 and persists it', () => {
  const originalGetProjectById = projectsDb.getProjectById;
  const originalUpdateProjectNotifyEnabledById = projectsDb.updateProjectNotifyEnabledById;

  let currentNotifyEnabled = 0;
  let capturedProjectId = '';
  let capturedState = false;

  try {
    projectsDb.getProjectById = () =>
      ({
        project_id: 'project-1',
        project_path: '/workspace/project-1',
        custom_project_name: 'project-1',
        isStarred: 0,
        isArchived: 0,
        notifyEnabled: currentNotifyEnabled,
      }) as ProjectRow;
    projectsDb.updateProjectNotifyEnabledById = (projectId: string, notifyEnabled: boolean) => {
      capturedProjectId = projectId;
      capturedState = notifyEnabled;
      currentNotifyEnabled = notifyEnabled ? 1 : 0;
    };

    const firstToggle = toggleProjectNotify('project-1');
    assert.equal(firstToggle.notifyEnabled, true);
    assert.equal(capturedProjectId, 'project-1');
    assert.equal(capturedState, true);

    const secondToggle = toggleProjectNotify('project-1');
    assert.equal(secondToggle.notifyEnabled, false);
    assert.equal(capturedState, false);
  } finally {
    projectsDb.getProjectById = originalGetProjectById;
    projectsDb.updateProjectNotifyEnabledById = originalUpdateProjectNotifyEnabledById;
  }
});
