export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
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
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
export { taskAttachmentsDb } from '@/modules/database/repositories/task-attachments.db.js';
export type {
  CreateTaskAttachmentInput,
  TaskAttachmentRow,
} from '@/modules/database/repositories/task-attachments.db.js';
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
