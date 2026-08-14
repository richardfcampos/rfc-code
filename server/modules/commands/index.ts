/**
 * Public surface of the commands module: the built-in slash commands whose
 * work happens on the server, and the boot hook that hands them a runtime.
 */

export {
  // Handler for `/btw`, wired into the built-in command map by the route.
  executeBtwCommand,
  // The entrypoint owns the Claude SDK import and hands it over at boot.
  configureBtwRuntime,
} from '@/modules/commands/btw-command.service.js';
export type {
  BtwCommandContext,
  BtwCommandResult,
  EphemeralQuery,
} from '@/modules/commands/btw-command.service.js';
