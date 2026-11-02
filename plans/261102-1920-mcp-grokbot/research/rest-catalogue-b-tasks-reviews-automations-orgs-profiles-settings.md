# Research — REST catalogue B (tasks, reviews, automations, orgs, collab, agent-messages, team-view, profiles, settings, notifications, plugins, browser-use, assets, inline)

Source: investigator subagent, 2026-11-02. `W` = `{success:true,data}`; `RAW` = bare JSON. AppError → `{success:false,error:{code,message,details}}`.

## Enums (DB repositories / module types)
- TaskStage `backlog|in_progress|review|done`; TaskOrigin `user|agent|automation`; TaskEvidenceKind `note|link|attachment`
- TaskReviewState `open|approved|changes_requested|closed`; ReviewCommentState `open|resolved`
- AutomationTriggerKind `cron|task_stage|webhook|quota_threshold`; AutomationActionKind `prompt_agent|create_task|notify_push`; AutomationRunStatus `success|failed|skipped`
- AgentMessageState `queued|delivered|acknowledged|answered|failed`; box `inbox|outbox`
- LLMProvider `claude|codex|cursor|opencode`; CAVEMAN_MODES `off|lite|full|ultra`; RTK_MODES `off|normal|ultra-compact`
- OrgProjectRuleKind `path_prefix|project_name`; OrgProfileRole `primary|fallback`
- CollabMode `debate|review|vote|council`; CollabStatus `running|converged|exhausted|stopped|failed`
- TeamViewSessionState `running|idle`; browser-use runtime `cloud|local`, session status `ready|stopped|unavailable`

## /api/tasks (W) — tasks.routes.ts + task-decomposition.routes.ts
- GET /?project=<project_name> → {tasks}
- POST / {title, project, origin?, description?, origin_detail?, assignee_profile_id?, suggested_skill?, worktree_branch?} → 201 {task}
- GET /:id → {task, attachments, evidence}
- PATCH /:id {title?, stage?, description?, assignee_profile_id?, suggested_skill?, worktree_branch?} → {task} (stage→review with worktree_branch opens a review; fires task_stage automations)
- DELETE /:id → {task}
- POST /:id/attachments (multipart "file") ; GET /:id/attachments/:attachmentId/download ; DELETE /:id/attachments/:attachmentId
- POST /:id/evidence {kind, content, attachment_id?} → 201 {evidence} ; DELETE /:id/evidence/:evidenceId
- POST /:id/subtasks {subtasks:[{title, description?, skill?, dependsOn?:number[]}], origin_detail?} → 201 {parent, subtasks, dependencies}
- GET /:id/subtasks → {parent, subtasks, dependencies} ; GET /:id/subtasks/ready → {ready}
Errors: TASK_VALIDATION_ERROR 400, TASK_NOT_FOUND 404, TASK_ATTACHMENT_NOT_FOUND, TASK_EVIDENCE_NOT_FOUND. Limits: title 500, evidence 10k, 50 subtasks.

## /api/reviews (W)
- GET /?state=<csv open|approved|changes_requested|closed>&project= → {reviews}
- GET /:id → {review, task, worktree:{repositoryRoot,worktreePath,branch,baseBranch}, files, comments}
- GET /:id/diff?file= → {file, diff}
- POST /:id/comments {filePath, lineNo?, body} → 201 {comment, routing}
- POST /:id/approve {squash?, message?, removeWorktree?} → {review, merge, task, taskUpdateError}
- POST /:id/request-changes {body?} → {review, comment, routing}
Errors: REVIEW_NOT_FOUND 404, REVIEW_STATE_INVALID 409, REVIEW_WORKTREE_MISSING 409, REVIEW_FILE_NOT_IN_DIFF 404.

## /api/automations (W) ; webhook router at /api/automations/webhook/:id (no JWT, secret header)
AutomationView {automationId, name, enabled, triggerKind, triggerConfig, actionKind, actionConfig, createdAt, updatedAt}
trigger_config: cron {cron} | task_stage {toStage, fromStage?, project?} | webhook {} | quota_threshold {profileId, thresholdPct, cooldownMinutes?}
action_config: prompt_agent {projectPath, promptTemplate, provider?, profileId?, skill?, worktreePath?, worktreeBranch?} | create_task {project, title, description?, suggestedSkill?, assigneeProfileId?} | notify_push {message, userId?}
- GET / → {automations} ; POST / {name, trigger_kind, trigger_config, action_kind, action_config, enabled?} → 201 {automation, secret?}
- GET /:id ; PATCH /:id (partial) ; DELETE /:id ; GET /:id/runs?limit ; POST /:id/fire → {result:{status,detail,attempts}} ; POST /:id/webhook-secret → {automation, secret}

## /api/orgs (W)
OrgDetail {id, name, isDefault, fallbackThreshold, rules[{id,kind,pattern}], policies[{profileId, role, priority}]}
- GET / → OrgDetail[] ; GET /allowed-profiles?project&provider ; GET /recommend?project&provider → {profileId, role, usagePct, reason}
- POST / {name, fallbackThreshold?} → 201 ; PATCH /:id {name?, fallbackThreshold?} ; DELETE /:id → 204
- POST /:id/rules {kind, pattern} → 201 ; DELETE /:id/rules/:ruleId → 204 ; PUT /:id/policies [ {profileId, role, priority?} ] (array body)

## /api/collaborations (W)
- POST / {topic, projectPath, mode, maxRounds?, participants:[{profileId, role?, model?, effort?}] (2..4), budget?} → 201 {collaboration}
- GET /?projectPath ; GET /:id (with turns) ; POST /:id/stop ; DELETE /:id

## /api/agent-messages (W, read-only)
- GET /?sessionId&box&state → {messages}

## /api/team-view (W)
- GET / → {sessions[{sessionId, provider, profileId, state, taskId, taskTitle, startedAt, usagePct}], edges[]}

## /api/profiles (W)
ProfileView {id, provider, name, slug, createdAt, cavemanMode, rtkMode, isDefault, authenticated}
- GET /?provider ; POST / {provider, name} → 201 ; GET /:id/status ; GET /usage?force&active ; GET /:id/usage
- PATCH /:id/tooling {cavemanMode?, rtkMode?} ; PATCH /:id/default {isDefault} ; DELETE /:id
- GET /:id/skills → {skills[{name,description,required}], enabled[]} ; PUT /:id/skills {enabled[]} ; POST /:id/skills/restore
- PATCH /sessions/:sessionId/tooling {cavemanMode} ; POST /sessions/:sessionId/handoff {profileId} → {handoff:{status,...}}

## /api/settings (RAW)
- GET /api-keys ; POST /api-keys {keyName} → {success, apiKey:{...full key}} ; DELETE /api-keys/:keyId ; PATCH /api-keys/:keyId/toggle {isActive}
- GET /credentials?type ; POST /credentials {credentialName, credentialType, credentialValue, description?} ; DELETE /credentials/:id ; PATCH /credentials/:id/toggle {isActive}
- GET /notification-preferences ; PUT /notification-preferences <object>
- GET /push/vapid-public-key ; POST /push/subscribe ; POST /push/unsubscribe

## /api/notifications (RAW)
- GET /endpoints?channel ; POST /endpoints/current {channel, endpointId, label?, metadata?, enabled?} ; PATCH /endpoints/:channel/:endpointId {enabled} ; DELETE /endpoints/:channel/:endpointId
- GET /notify-hub → {config:{url, hasToken, tokenHint, timezone, source, configured}} ; PUT /notify-hub {url, token?, timezone?} ; POST /notify-hub/test

## /api/plugins (RAW)
- GET / → {plugins[+serverRunning]} ; GET /:name/manifest ; GET /:name/assets/* ; PUT /:name/enable {enabled} ; POST /install {url} ; POST /:name/update ; ALL /:name/rpc/* (proxy) ; DELETE /:name

## /api/browser-use (hand-built {success,data})
- GET /status ; GET /settings ; PUT /settings {enabled?} ; POST /runtime/install ; GET /sessions ; POST /sessions/:id/stop ; DELETE /sessions/:id

## /api/assets (RAW, multipart)
- POST /images ; POST /files ; GET /files/:filename ; GET /images/:filename

## Inline (server/index.js, RAW)
- GET /health (no auth)
- POST /api/system/update ; GET /api/browse-filesystem?path ; POST /api/create-folder {path}
- GET /api/projects/:projectId/file?filePath → {content, path} ; GET /api/projects/:projectId/files/content?path (bytes) ; PUT /api/projects/:projectId/file {filePath, content}
- GET /api/projects/:projectId/files (tree) ; POST /api/projects/:projectId/files/create {name, type:file|directory, path?} ; PUT /api/projects/:projectId/files/rename {oldPath, newName} ; DELETE /api/projects/:projectId/files {path} (JSON body on DELETE) ; POST /api/projects/:projectId/files/upload (multipart)
- GET /api/projects/:projectId/sessions/:sessionId/token-usage

Notes: tasks `?project=` is project NAME (task.project_name); `/api/projects/:projectId` is DB id. No pagination on any B route.
