# Research — REST catalogue A (projects, providers, worktrees, git, commands, preview, user, auth, taskmaster, cursor, mcp-utils)

Source: investigator subagent, 2026-11-02. Totals: projects 14, providers 20, worktrees 5, git 22, commands 2, preview 5, user 4, auth 5, taskmaster 11, cursor 1, mcp-utils 1 = 90 routes.

Conventions: TS modules return `{success:true,data}` (AppError → `{success:false,error:{code,message,details}}`); legacy JS routes (git, commands, preview, user, auth, taskmaster, cursor, mcp-utils) return RAW JSON with `{error}` on failure (git GET reads return HTTP 200 + `{error}`). `projectId` = DB id (`projects` table); git/worktrees `project` param = same id.

## /api/projects
- GET / | query skipSynchronization|skipSync='1', sessionsLimit, sessionsOffset | RAW projects-with-sessions
- GET /archived | {success,data:{projects}}
- GET /:projectId/sessions | query limit(20), offset(0) | RAW page
- POST /create-project | body {path (req), customName?} | RAW {success,project,message}
- POST /migrate-legacy-stars | body {projectIds[]}
- GET /clone-progress | SSE (path, githubUrl, githubTokenId?, newGithubToken?) — stream
- GET /:projectId/taskmaster | RAW
- GET /:projectId/codegraph | RAW ; POST /:projectId/codegraph/init → 202
- PUT /:projectId/rename | body {displayName}
- POST /:projectId/toggle-star | RAW {success,isStarred}
- POST /:projectId/toggle-notify | RAW {success,notifyEnabled}
- POST /:projectId/restore | {success,data:{projectId,isArchived:false}}
- DELETE /:projectId | query force='true' (hard delete) else archive

## /api/providers  (provider ∈ claude|codex|cursor|opencode; scope ∈ user|local|project; transport ∈ stdio|http|sse)
- GET /:provider/auth/status → {installed,provider,authenticated,email,method}
- GET /:provider/models?bypassCache ; POST /:provider/sessions/:sessionId/active-model {model}
- GET /capabilities ; GET /:provider/capabilities
- GET /:provider/skills?workspacePath&profileId ; POST /:provider/skills {entries:[{content, directoryName?, fileName?, files?[{relativePath,content,encoding}]}]} ; DELETE /:provider/skills/:directoryName
- GET /:provider/mcp/servers?scope&workspacePath ; POST /:provider/mcp/servers {name, transport, scope?, workspacePath?, command?, args?, env?, cwd?, url?, headers?, envVars?, bearerTokenEnvVar?, envHttpHeaders?} → 201 ; DELETE /:provider/mcp/servers/:name?scope&workspacePath ; POST /mcp/servers/global (scope user|project)
- POST /sessions {provider, projectPath, profileId?} → 201 {sessionId,...}
- GET /sessions/running ; GET /sessions/archived
- DELETE /sessions/:sessionId?force&deletedFromDisk ; POST /sessions/:sessionId/restore
- PUT /sessions/:sessionId {summary (≤500), taskId?|null}
- GET /sessions/:sessionId/messages?limit&offset
- GET /search/sessions?q(≥2)&limit(50) — SSE stream

## /api/worktrees (project = projectId)
- GET /?project → {repositoryRoot, baseBranch, worktrees[{path,branch,headSha,isMain,isCurrent,isLocked,isDetached,changedFileCount,ahead,behind,lastCommitSubject,lastCommitDate,linkedProjectId,linkedProjectArchived}]}
- POST /create {project, branch, baseBranch?, uniqueBranch?} → registers as project
- POST /open {project, worktreePath}
- POST /merge {project, worktreePath, squash?, message?, removeAfterMerge?}
- POST /remove {project, worktreePath, force?, deleteBranch?}

## /api/git (RAW; `project` = projectId)
GET status, diff(file), file-with-diff(file), branches, commits(limit≤100), commit-diff(commit), remote-status.
POST initial-commit, commit {project,message,files[]}, stage {files[]}, unstage {files[]}, revert-local-commit, checkout {branch}, create-branch {branch}, delete-branch {branch}, generate-commit-message {files[], provider?}, fetch, pull, push, publish {branch}, discard {file}, delete-untracked {file}.

## /api/commands (RAW)
- POST /list {projectPath?} → {builtIn[], custom[], count}
- POST /execute {commandName, commandPath?, args?[], context?{provider,sessionId,projectPath,tokenUsage,model}} ; builtins: /help /models /btw /cost /status /memory /config

## /api/preview (RAW)
GET /config/:projectId ; PUT /config/:projectId {command, setupCommand?, bindHost?, port?} ; POST /start/:projectId {cwd?} ; GET /status/:projectId?cwd ; POST /stop/:projectId {cwd?}

## /api/user (RAW)
GET /git-config ; POST /git-config {gitName,gitEmail} ; POST /complete-onboarding ; GET /onboarding-status

## /api/auth (no JWT)
GET /status ; POST /register ; POST /login ; GET /user ; POST /logout

## /api/taskmaster (RAW)
GET /installation-status ; GET /tasks/:projectId ; GET /prd/:projectId ; POST /prd/:projectId {fileName,content} ; GET /prd/:projectId/:fileName ; POST /init/:projectId ; POST /add-task/:projectId {prompt?|title+description, priority?, dependencies?} ; PUT /update-task/:projectId/:taskId {status?|title?,description?,priority?,details?,prompt?} ; POST /parse-prd/:projectId {fileName?, numTasks?, append?} ; GET /prd-templates ; POST /apply-template/:projectId {templateId, fileName?, customizations?}

## misc
GET /api/cursor/config ; GET /api/mcp-utils/taskmaster-server?projectId

## Inline in server/index.js (authenticateToken)
POST /api/system/update ; GET /api/browse-filesystem ; POST /api/create-folder ; GET /api/projects/:projectId/file ; GET /api/projects/:projectId/files/content ; PUT /api/projects/:projectId/file ; GET /api/projects/:projectId/files ; POST /api/projects/:projectId/files/create ; PUT /api/projects/:projectId/files/rename ; DELETE /api/projects/:projectId/files ; POST /api/projects/:projectId/files/upload ; GET /api/projects/:projectId/sessions/:sessionId/token-usage
