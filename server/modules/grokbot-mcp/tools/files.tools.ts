/** Editor file tools: tree, read/write, create/rename/delete and multipart upload inside a project. */

import type { JsonObject, RestMultipartFile, ToolDefinition } from '../grokbot-mcp.types.js';

import { optStr, PROJECT_ID, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const FILE_TYPES = ['file', 'directory'] as const;

const filesPath = (args: JsonObject, suffix: string): string => `/api/projects/${seg(str(args, 'projectId'))}${suffix}`;

/** Validates the `files` argument and maps it to multipart parts for the `files` field. */
export function readUploadFiles(args: JsonObject, field: string): RestMultipartFile[] {
  const raw = args.files;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('files must be a non-empty array.');
  }
  return raw.map((entry, index) => {
    const file = (entry ?? {}) as JsonObject;
    const name = typeof file.name === 'string' ? file.name.trim() : '';
    if (!name || typeof file.contentBase64 !== 'string') {
      throw new ToolInputError(`files[${index}] needs name and contentBase64.`);
    }
    const mimeType = optStr(file, 'mimeType');
    return { field, fileName: name, contentBase64: file.contentBase64, ...(mimeType ? { mimeType } : {}) };
  });
}

export const fileTools: ToolDefinition[] = [
  tool({
    name: 'file_tree',
    description: 'Return the recursive file tree of a project (size-bounded, skips heavy folders). Use to locate files before file_read.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/projects/:projectId/files'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: filesPath(args, '/files') }),
  }),
  tool({
    name: 'file_read',
    description: 'Read a text file of a project. filePath may be project-relative or absolute inside the project.',
    inputSchema: schema({ projectId: PROJECT_ID, filePath: S.string('File path, relative to the project root or absolute.') }, ['projectId', 'filePath']),
    covers: ['GET /api/projects/:projectId/file'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: filesPath(args, '/file'), query: { filePath: str(args, 'filePath') } }),
  }),
  tool({
    name: 'file_read_bytes',
    description: 'Read a file of a project as raw bytes (base64), for images and other binary content. Large files are truncated.',
    inputSchema: schema({ projectId: PROJECT_ID, path: S.string('File path, relative to the project root or absolute.') }, ['projectId', 'path']),
    covers: ['GET /api/projects/:projectId/files/content'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: filesPath(args, '/files/content'), query: { path: str(args, 'path') }, responseType: 'bytes' }),
  }),
  tool({
    name: 'file_write',
    description: 'Overwrite (or create) a text file of a project with the given content. An empty string is allowed and empties the file.',
    inputSchema: schema({
      projectId: PROJECT_ID,
      filePath: S.string('File path, relative to the project root or absolute.'),
      content: S.string('Full new file content.'),
    }, ['projectId', 'filePath', 'content']),
    covers: ['PUT /api/projects/:projectId/file'],
    run: (args, ctx) => {
      // Empty content is a legitimate write, so presence is checked, not truthiness.
      const content = optStr(args, 'content');
      if (content === undefined) {
        throw new ToolInputError('content is required.');
      }
      return ctx.api.dispatch({ method: 'PUT', path: filesPath(args, '/file'), body: { filePath: str(args, 'filePath'), content } });
    },
  }),
  tool({
    name: 'file_create',
    description: 'Create an empty file or a directory inside a project. path is the parent directory (project root when omitted).',
    inputSchema: schema({
      projectId: PROJECT_ID,
      name: S.string('Name of the new entry (no slashes).'),
      type: S.enumOf(FILE_TYPES, 'Whether to create a file or a directory.'),
      path: S.string('Parent directory, relative to the project root; omit for the root.'),
    }, ['projectId', 'name', 'type']),
    covers: ['POST /api/projects/:projectId/files/create'],
    run: (args, ctx) => {
      const type = str(args, 'type');
      if (!(FILE_TYPES as readonly string[]).includes(type)) {
        throw new ToolInputError(`type must be one of ${FILE_TYPES.join(', ')}.`);
      }
      const path = optStr(args, 'path');
      return ctx.api.dispatch({
        method: 'POST',
        path: filesPath(args, '/files/create'),
        body: { name: str(args, 'name'), type, ...(path !== undefined && { path }) },
      });
    },
  }),
  tool({
    name: 'file_rename',
    description: 'Rename a file or directory inside a project (same parent folder; newName is a bare name).',
    inputSchema: schema({
      projectId: PROJECT_ID,
      oldPath: S.string('Current path, relative to the project root.'),
      newName: S.string('New bare name (no slashes).'),
    }, ['projectId', 'oldPath', 'newName']),
    covers: ['PUT /api/projects/:projectId/files/rename'],
    run: (args, ctx) => ctx.api.dispatch({
      method: 'PUT',
      path: filesPath(args, '/files/rename'),
      body: { oldPath: str(args, 'oldPath'), newName: str(args, 'newName') },
    }),
  }),
  tool({
    name: 'file_delete',
    description: 'Delete a file or a directory (recursively) inside a project. Irreversible.',
    inputSchema: schema({ projectId: PROJECT_ID, path: S.string('Path to delete, relative to the project root.') }, ['projectId', 'path']),
    covers: ['DELETE /api/projects/:projectId/files'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: filesPath(args, '/files'), body: { path: str(args, 'path') } }),
  }),
  tool({
    name: 'file_upload',
    description: 'Upload one or more files (base64 content) into a project directory. targetPath is the destination folder, created if missing; project root when omitted.',
    inputSchema: schema({
      projectId: PROJECT_ID,
      files: S.array(
        schema({
          name: S.string('File name.'),
          contentBase64: S.string('File bytes, base64-encoded.'),
          mimeType: S.string('Optional MIME type.'),
        }, ['name', 'contentBase64']) as JsonObject,
        'Files to upload.',
      ),
      targetPath: S.string('Destination folder relative to the project root.'),
    }, ['projectId', 'files']),
    covers: ['POST /api/projects/:projectId/files/upload'],
    run: (args, ctx) => {
      const files = readUploadFiles(args, 'files');
      const targetPath = optStr(args, 'targetPath');
      return ctx.api.dispatch({
        method: 'POST',
        path: filesPath(args, '/files/upload'),
        multipart: {
          files,
          fields: { ...(targetPath ? { targetPath } : {}), requestedFileCount: String(files.length) },
        },
      });
    },
  }),
];
