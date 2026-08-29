export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
export { activePreviewsDb } from '@/modules/database/repositories/active-previews.db.js';
export type { ActivePreviewRow } from '@/modules/database/repositories/active-previews.db.js';
export { activeSessionRunsDb } from '@/modules/database/repositories/active-session-runs.db.js';
export type { ActiveSessionRunRow } from '@/modules/database/repositories/active-session-runs.db.js';
export { agentMessagesDb } from '@/modules/database/repositories/agent-messages.db.js';
export type {
  AgentMessageBox,
  AgentMessageRow,
  AgentMessageState,
  CreateAgentMessageInput,
  ListAgentMessagesFilter,
} from '@/modules/database/repositories/agent-messages.db.js';
export { previewConfigsDb } from '@/modules/database/repositories/preview-configs.db.js';
export type { PreviewConfigRow } from '@/modules/database/repositories/preview-configs.db.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { automationsDb } from '@/modules/database/repositories/automations.db.js';
export type {
  AutomationActionKind,
  AutomationRow,
  AutomationRunRow,
  AutomationRunStatus,
  AutomationTriggerKind,
  CreateAutomationInput,
  RecordAutomationRunInput,
  UpdateAutomationInput,
} from '@/modules/database/repositories/automations.db.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
export { githubTokensDb } from '@/modules/database/repositories/github-tokens.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
export { orgsDb } from '@/modules/database/repositories/orgs.db.js';
export type {
  OrgProfilePolicyRow,
  OrgProjectRuleRow,
  OrgRow,
} from '@/modules/database/repositories/orgs.db.js';
export { projectsDb } from '@/modules/database/repositories/projects.db.js';
export { pushSubscriptionsDb } from '@/modules/database/repositories/push-subscriptions.js';
export { reviewCommentsDb } from '@/modules/database/repositories/review-comments.db.js';
export type {
  CreateReviewCommentInput,
  ReviewCommentAuthor,
  ReviewCommentRow,
  ReviewCommentState,
} from '@/modules/database/repositories/review-comments.db.js';
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
export { LIVE_REVIEW_STATES, taskReviewsDb } from '@/modules/database/repositories/task-reviews.db.js';
export type {
  TaskReviewRow,
  TaskReviewState,
  TaskReviewWithTaskRow,
} from '@/modules/database/repositories/task-reviews.db.js';
export { taskAttachmentsDb } from '@/modules/database/repositories/task-attachments.db.js';
export type {
  CreateTaskAttachmentInput,
  TaskAttachmentRow,
} from '@/modules/database/repositories/task-attachments.db.js';
export { taskDependenciesDb } from '@/modules/database/repositories/task-dependencies.db.js';
export type {
  CreateDecompositionInput,
  SubtaskDraft,
  SubtaskRow,
  TaskDependencyRow,
} from '@/modules/database/repositories/task-dependencies.db.js';
export { taskEvidenceDb } from '@/modules/database/repositories/task-evidence.db.js';
export type {
  CreateTaskEvidenceInput,
  TaskEvidenceKind,
  TaskEvidenceRow,
} from '@/modules/database/repositories/task-evidence.db.js';
export { sessionLegsDb } from '@/modules/database/repositories/session-legs.db.js';
export type { LegRow } from '@/modules/database/repositories/session-legs.db.js';
export { sessionRunFailuresDb } from '@/modules/database/repositories/session-run-failures.db.js';
export type { SessionRunFailureRow } from '@/modules/database/repositories/session-run-failures.db.js';
export { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
export type { SessionRow } from '@/modules/database/repositories/sessions.db.js';
export { tasksDb } from '@/modules/database/repositories/tasks.db.js';
export type {
  CreateTaskInput,
  ProfileFallbackAuditRow,
  TaskOrigin,
  TaskRow,
  TaskStage,
  UpdateTaskInput,
} from '@/modules/database/repositories/tasks.db.js';
export { userDb } from '@/modules/database/repositories/users.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
