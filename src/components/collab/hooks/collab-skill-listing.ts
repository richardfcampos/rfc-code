// Reading the skills a set of Claude accounts can load, and matching them
// against what the user typed. Pure data work, kept apart from the autocomplete
// hook so neither file has to be read to understand the other.
//
// Listings are per profile because skills live under each profile's own config
// directory: a name one account has is not a name another one can load.

import { requestJson } from './collab-api';

export interface CollabSkillSuggestion {
  /** Exactly what lands in the topic, `/` prefix included. */
  command: string;
  description?: string;
  /** How many of the seated Claude accounts can load it. */
  availableTo: number;
}

type ListedSkill = { command: string; description?: string };

type SkillsPayload = {
  skills?: { command?: string; description?: string }[];
};

export const SKILLS_FAILED_TO_LOAD = 'Failed to load skills';

const MAX_SUGGESTIONS = 8;

async function fetchProfileSkills(
  projectPath: string,
  profileId: string,
): Promise<ListedSkill[]> {
  const params = new URLSearchParams({ profileId });
  if (projectPath) {
    params.set('workspacePath', projectPath);
  }
  const data = await requestJson<SkillsPayload>(
    `/api/providers/claude/skills?${params.toString()}`, undefined, SKILLS_FAILED_TO_LOAD,
  );

  // The prefix is what makes an entry usable as typed text; anything the
  // provider reports without one is not something a topic can invoke.
  return (data.skills ?? [])
    .filter((skill): skill is ListedSkill =>
      typeof skill.command === 'string' && skill.command.startsWith('/'))
    .map((skill) => ({ command: skill.command, description: skill.description }));
}

/** Merges every seat's listing, counting how many of them offer each name. */
function mergeSkills(perProfile: ListedSkill[][]): CollabSkillSuggestion[] {
  const merged = new Map<string, CollabSkillSuggestion>();

  perProfile.forEach((skills) => {
    const seenHere = new Set<string>();
    skills.forEach((skill) => {
      // One account can expose the same invocation from two plugin folders; it
      // still counts once towards availability.
      if (seenHere.has(skill.command)) {
        return;
      }
      seenHere.add(skill.command);

      const existing = merged.get(skill.command);
      merged.set(skill.command, {
        command: skill.command,
        description: existing?.description || skill.description,
        availableTo: (existing?.availableTo ?? 0) + 1,
      });
    });
  });

  return [...merged.values()].sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * Every skill the given profiles can load. Rejects if any listing fails: a
 * partial merge would report wrong availability counts for the ones that did
 * answer, which is worse than saying the listing is unavailable.
 */
export async function loadCollabSkills(
  projectPath: string,
  profileIds: readonly string[],
): Promise<CollabSkillSuggestion[]> {
  const perProfile = await Promise.all(
    profileIds.map((profileId) => fetchProfileSkills(projectPath, profileId)),
  );
  return mergeSkills(perProfile);
}

/** Prefix match first, so a typed name narrows like path completion does. */
export function filterCollabSkills(
  skills: readonly CollabSkillSuggestion[],
  query: string,
): CollabSkillSuggestion[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return skills.slice(0, MAX_SUGGESTIONS);
  }

  const prefixed = skills.filter((skill) => skill.command.toLowerCase().startsWith(`/${normalized}`));
  const matches = prefixed.length > 0
    ? prefixed
    : skills.filter((skill) =>
      skill.command.toLowerCase().includes(normalized)
      || skill.description?.toLowerCase().includes(normalized));

  return matches.slice(0, MAX_SUGGESTIONS);
}
