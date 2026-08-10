import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';

import SidebarSessionItem from './SidebarSessionItem';
import type { Project } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';

// Render coverage for the worktree branch badge: a session that runs inside a
// git worktree shows the branch (or the worktree folder name when the branch
// is unknown), and a plain session renders without any branch badge.

const t = ((key: string) => key) as TFunction;

const project: Project = {
  projectId: 'project-1',
  displayName: 'rfc-code',
  fullPath: '/repo',
};

const noop = () => {};

function renderSessionItem(session: SessionWithProvider): string {
  return renderToStaticMarkup(
    React.createElement(SidebarSessionItem, {
      project,
      session,
      selectedSession: null,
      isProcessing: false,
      needsAttention: false,
      currentTime: new Date('2026-07-31T12:00:00Z'),
      editingSession: null,
      editingSessionName: '',
      onEditingSessionNameChange: noop,
      onStartEditingSession: noop,
      onCancelEditingSession: noop,
      onSaveEditingSession: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      onDeleteSession: noop,
      t,
    }),
  );
}

function makeSession(overrides: Partial<SessionWithProvider> = {}): SessionWithProvider {
  return {
    id: 'session-1',
    summary: 'Fix login flow',
    lastActivity: '2026-07-31T11:30:00Z',
    __provider: 'claude',
    ...overrides,
  };
}

test('renders the branch badge for a session running inside a worktree', () => {
  const markup = renderSessionItem(
    makeSession({
      worktreePath: '/repo-worktrees/feature-login',
      worktreeBranch: 'feature/login',
    }),
  );

  assert.ok(markup.includes('feature/login'), 'badge must show the worktree branch');
});

test('falls back to the worktree folder name when the branch is unknown', () => {
  const markup = renderSessionItem(
    makeSession({
      worktreePath: '/repo-worktrees/feature-login',
      worktreeBranch: null,
    }),
  );

  assert.ok(markup.includes('feature-login'), 'badge must fall back to the worktree basename');
});

test('renders no branch badge for a session without a worktree', () => {
  const markup = renderSessionItem(makeSession());

  // The badge is the only place this icon appears in the session row.
  assert.ok(!markup.includes('lucide-git-branch'), 'plain sessions must render without the badge');
});
