/** TaskMaster project tasks and PRD documents; the UAT preview tools are re-exported alongside. */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { PROJECT_ID, S, ToolInputError, optStr, pick, schema, seg, str, tool, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';
import { previewTools } from './preview.tools.js';

const TASK_STATUSES = ['pending', 'in-progress', 'done', 'review', 'deferred', 'cancelled'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

/** PRD content may legitimately be short but must be present; blank-only is rejected by the server's own check. */
function requiredText(args: JsonObject, name: string): string {
  const value = optStr(args, name);
  if (value === undefined) {
    throw new ToolInputError(`${name} is required.`);
  }
  return value;
}

const projectPath = (args: JsonObject, route: string): string => `/api/taskmaster/${route}/${seg(str(args, 'projectId'))}`;

const taskmasterCoreTools: ToolDefinition[] = [
  tool({
    name: 'taskmaster_installation_status',
    description: 'Check whether the TaskMaster CLI is installed on the server and which version.',
    inputSchema: schema({}),
    covers: ['GET /api/taskmaster/installation-status'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/taskmaster/installation-status' }),
  }),
  tool({
    name: 'taskmaster_tasks',
    description: 'List the TaskMaster tasks (tasks.json) of a project, with subtasks, statuses and dependencies.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/taskmaster/tasks/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: projectPath(args, 'tasks') }),
  }),
  tool({
    name: 'taskmaster_init',
    description: 'Initialise TaskMaster in a project (creates .taskmaster/). Run once before adding tasks or PRDs.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['POST /api/taskmaster/init/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: projectPath(args, 'init') }),
  }),
  tool({
    name: 'taskmaster_add_task',
    description:
      'Add a TaskMaster task. Give either a prompt (the AI drafts the task) or title and description. dependencies is a comma-separated id list.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        prompt: S.string('Free-form description the AI turns into a task.'),
        title: S.string('Task title (manual mode).'),
        description: S.string('Task description (manual mode).'),
        priority: S.enumOf(PRIORITIES, 'Priority; defaults to medium.'),
        dependencies: S.string('Comma-separated ids of existing tasks this one depends on, e.g. "1,3" (passed to the CLI verbatim).'),
      },
      ['projectId'],
    ),
    covers: ['POST /api/taskmaster/add-task/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST',
        path: projectPath(args, 'add-task'),
        body: pick(args, ['prompt', 'title', 'description', 'priority', 'dependencies']),
      }),
  }),
  tool({
    name: 'taskmaster_update_task',
    description:
      'Update a TaskMaster task. Only the given fields change; a lone status is a quick status move, prompt asks the AI to rewrite the task.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        taskId: S.string('TaskMaster task id, e.g. "3" or "3.2" for a subtask.'),
        status: S.enumOf(TASK_STATUSES, 'New status.'),
        title: S.string('New title.'),
        description: S.string('New description.'),
        priority: S.enumOf(PRIORITIES, 'New priority.'),
        details: S.string('Implementation details.'),
        prompt: S.string('Instruction for the AI to update the task with.'),
      },
      ['projectId', 'taskId'],
    ),
    covers: ['PUT /api/taskmaster/update-task/:projectId/:taskId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'PUT',
        path: `${projectPath(args, 'update-task')}/${seg(str(args, 'taskId'))}`,
        body: pick(args, ['status', 'title', 'description', 'priority', 'details', 'prompt']),
      }),
  }),
  tool({
    name: 'taskmaster_parse_prd',
    description: 'Generate TaskMaster tasks from a PRD file in the project. Slow (AI call); set append to keep existing tasks.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        fileName: S.string('PRD file name in .taskmaster/docs; defaults to prd.txt.'),
        numTasks: S.integer('Approximate number of tasks to generate.'),
        append: S.boolean('Append to existing tasks instead of replacing them.'),
      },
      ['projectId'],
    ),
    covers: ['POST /api/taskmaster/parse-prd/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: projectPath(args, 'parse-prd'), body: pick(args, ['fileName', 'numTasks', 'append']) }),
  }),
];

const prdTools: ToolDefinition[] = [
  tool({
    name: 'prd_list',
    description: 'List the PRD documents stored in a project (.taskmaster/docs).',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/taskmaster/prd/:projectId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: projectPath(args, 'prd') }),
  }),
  tool({
    name: 'prd_get',
    description: 'Read the content of one PRD document of a project.',
    inputSchema: schema({ projectId: PROJECT_ID, fileName: S.string('PRD file name, e.g. prd.txt.') }, ['projectId', 'fileName']),
    covers: ['GET /api/taskmaster/prd/:projectId/:fileName'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: `${projectPath(args, 'prd')}/${seg(str(args, 'fileName'))}` }),
  }),
  tool({
    name: 'prd_save',
    description: 'Create or overwrite a PRD document in a project with the given content.',
    inputSchema: schema(
      { projectId: PROJECT_ID, fileName: S.string('PRD file name, e.g. prd.txt.'), content: S.string('Full PRD text.') },
      ['projectId', 'fileName', 'content'],
    ),
    covers: ['POST /api/taskmaster/prd/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: projectPath(args, 'prd'),
        body: { fileName: str(args, 'fileName'), content: requiredText(args, 'content') },
      }),
  }),
  tool({
    name: 'prd_templates',
    description: 'List the built-in PRD templates (id, name, description) usable with prd_apply_template.',
    inputSchema: schema({}),
    covers: ['GET /api/taskmaster/prd-templates'],
    run: (_args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/taskmaster/prd-templates' }),
  }),
  tool({
    name: 'prd_apply_template',
    description: 'Create a PRD document from a template (see prd_templates), filling placeholders from customizations.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        templateId: S.string('Template id from prd_templates.'),
        fileName: S.string('Target file name; defaults to prd.txt.'),
        customizations: S.object('Values for the template placeholders.'),
      },
      ['projectId', 'templateId'],
    ),
    covers: ['POST /api/taskmaster/apply-template/:projectId'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: projectPath(args, 'apply-template'),
        body: { templateId: str(args, 'templateId'), ...pick(args, ['fileName', 'customizations']) },
      }),
  }),
];

export const taskmasterTools: ToolDefinition[] = [...taskmasterCoreTools, ...prdTools, ...previewTools];
