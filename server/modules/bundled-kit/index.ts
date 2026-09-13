/**
 * Public surface of the bundled agent kit module.
 *
 * Covers everything the kit ships apart from its skills, which stay in
 * `bundled-skills` because they are individually toggleable.
 */

export {
  getAgentKitRoot,
  isAgentKitAvailable,
  KIT_CONTENT_DIRS,
  linkKitContent,
  listLinkedKitContent,
  resolveAgentKitEnv,
  resolveKitHooksDir,
} from '@/modules/bundled-kit/bundled-kit.js';

export { applyKitHooks } from '@/modules/bundled-kit/kit-hooks.js';

export { ensureDefaultConfigDirKit } from '@/modules/bundled-kit/kit-bootstrap.js';
