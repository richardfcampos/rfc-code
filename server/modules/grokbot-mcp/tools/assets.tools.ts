/** Chat attachment storage: upload images/files into the global assets folder and read them back. */

import type { JsonObject, ToolContext, ToolDefinition } from '../grokbot-mcp.types.js';

import { optStr, S, schema, seg, str, tool, ToolInputError } from './tool-helpers.js';

const ASSET_KINDS = ['images', 'files'] as const;

const uploadSchema = (what: string) => schema({
  fileName: S.string(`Name of the ${what}, including extension.`),
  contentBase64: S.string('File bytes, base64-encoded.'),
  mimeType: S.string('MIME type; the server validates it for images.'),
}, ['fileName', 'contentBase64']);

function upload(field: 'images' | 'files', path: string, args: JsonObject, ctx: ToolContext): Promise<unknown> {
  const contentBase64 = args.contentBase64;
  if (typeof contentBase64 !== 'string' || contentBase64 === '') {
    throw new ToolInputError('contentBase64 is required.');
  }
  const mimeType = optStr(args, 'mimeType');
  return ctx.api.dispatch({
    method: 'POST',
    path,
    multipart: { files: [{ field, fileName: str(args, 'fileName'), contentBase64, ...(mimeType ? { mimeType } : {}) }] },
  });
}

export const assetTools: ToolDefinition[] = [
  tool({
    name: 'asset_upload_image',
    description: 'Store an image (JPEG, PNG, GIF, WebP, SVG; max 5 MB) in the global assets folder. Returns absolute paths to pass as images to session_send.',
    inputSchema: uploadSchema('image'),
    covers: ['POST /api/assets/images'],
    run: (args, ctx) => upload('images', '/api/assets/images', args, ctx),
  }),
  tool({
    name: 'asset_upload_file',
    description: 'Store any attachment (max 20 MB) in the global assets folder. Returns absolute paths the agent can read from disk; reference them in the message text.',
    inputSchema: uploadSchema('file'),
    covers: ['POST /api/assets/files'],
    run: (args, ctx) => upload('files', '/api/assets/files', args, ctx),
  }),
  tool({
    name: 'asset_download',
    description: 'Download a stored attachment by the filename returned from an upload. Returns the bytes as base64.',
    inputSchema: schema({
      kind: S.enumOf(ASSET_KINDS, 'Which asset store to read from.'),
      filename: S.string('Stored filename (not a path).'),
    }, ['kind', 'filename']),
    covers: ['GET /api/assets/files/:filename', 'GET /api/assets/images/:filename'],
    run: (args, ctx) => {
      const kind = str(args, 'kind');
      if (!(ASSET_KINDS as readonly string[]).includes(kind)) {
        throw new ToolInputError(`kind must be one of ${ASSET_KINDS.join(', ')}.`);
      }
      return ctx.api.dispatch({ method: 'GET', path: `/api/assets/${kind}/${seg(str(args, 'filename'))}`, responseType: 'bytes' });
    },
  }),
];
