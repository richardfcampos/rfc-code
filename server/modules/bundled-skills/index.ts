/**
 * Public surface of the bundled skills module: which skills ship with the app,
 * and which of them each account profile exposes to its sessions.
 */

export {
  applySkillSelection,
  disableSkill,
  enableAllSkills,
  enableSkill,
  ensureDefaultConfigDirSkills,
  resolveDefaultClaudeConfigDir,
  getBundledSkillsRoot,
  listBundledSkills,
  listEnabledSkills,
  repairSkillLinks,
  resolveProfileSkillsDir,
  type BundledSkill,
} from '@/modules/bundled-skills/bundled-skills.js';
