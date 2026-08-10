// Skill autocomplete for the collaboration topic.
//
// A topic reaches the provider verbatim, exactly like a composer message, so a
// `/skill-name` written into it is resolved by the CLI itself — there is
// nothing to transform here and nothing to execute. This hook only helps the
// user type a name that actually exists, which is why selecting a suggestion
// inserts plain text and nothing else.
//
// Scope is the Claude accounts already seated. Codex uses a different syntax
// (`$name`) and its loading outside the interactive CLI is unverified, so Codex
// seats contribute nothing here.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import {
  filterCollabSkills,
  loadCollabSkills,
  SKILLS_FAILED_TO_LOAD,
  type CollabSkillSuggestion,
} from './collab-skill-listing';
import { toMessage } from './collab-api';

interface UseCollabSkillAutocompleteOptions {
  /** Workspace whose project-scoped skills count as available. */
  projectPath: string;
  /** Profile ids of the Claude seats currently picked. */
  profileIds: readonly string[];
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

/** Same trigger the composer uses: a slash that opens a word, not one inside it. */
const SLASH_PATTERN = /(?:^|\s)(\/\S*)$/;

const NO_TRIGGER = { position: -1, query: '' };

export function useCollabSkillAutocomplete({
  projectPath, profileIds, value, onChange, textareaRef,
}: UseCollabSkillAutocompleteOptions) {
  const [skills, setSkills] = useState<CollabSkillSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(NO_TRIGGER);
  const [activeIndex, setActiveIndex] = useState(0);

  // Stable key: the caller rebuilds the id array on every keystroke, and
  // depending on the array itself would refetch the listing each time.
  const profileKey = useMemo(() => [...new Set(profileIds)].sort().join(','), [profileIds]);
  const seatCount = profileKey ? profileKey.split(',').length : 0;

  useEffect(() => {
    if (!profileKey) {
      // No Claude seat picked yet: there is no config directory to list, so the
      // menu stays out of the way instead of offering names nobody can run.
      setSkills([]);
      setError(null);
      return undefined;
    }
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await loadCollabSkills(projectPath, profileKey.split(','));
        if (!cancelled) {
          setSkills(loaded);
          setError(null);
        }
      } catch (loadFailure) {
        if (!cancelled) {
          // Autocomplete is a convenience — a failed listing must not block the
          // form, but staying silent would read as "this account has none".
          setSkills([]);
          setError(toMessage(loadFailure, SKILLS_FAILED_TO_LOAD));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profileKey, projectPath]);

  const close = useCallback(() => {
    setTrigger(NO_TRIGGER);
    setActiveIndex(0);
  }, []);

  const suggestions = useMemo(
    () => (trigger.position < 0 ? [] : filterCollabSkills(skills, trigger.query)),
    [skills, trigger],
  );

  const isOpen = trigger.position >= 0 && (suggestions.length > 0 || error !== null);

  const handleValueChange = useCallback((next: string, cursor: number) => {
    onChange(next);

    const beforeCursor = next.slice(0, cursor);
    // A slash inside a fenced block is code, not an invocation.
    const inCodeBlock = ((beforeCursor.match(/```/g) || []).length % 2) === 1;
    const match = inCodeBlock ? null : beforeCursor.match(SLASH_PATTERN);
    if (!match) {
      close();
      return;
    }

    setTrigger({
      position: (match.index ?? 0) + (match[0].length - match[1].length),
      query: match[1].slice(1),
    });
    setActiveIndex(0);
  }, [close, onChange]);

  const select = useCallback((suggestion: CollabSkillSuggestion) => {
    if (trigger.position < 0) {
      return;
    }

    const before = value.slice(0, trigger.position);
    const rest = value.slice(trigger.position);
    const wordEnd = rest.search(/\s/);
    const after = wordEnd === -1 ? '' : rest.slice(wordEnd);
    // Plain text insertion, nothing more: the user goes on typing arguments
    // after it exactly as they would in the composer.
    const separator = /^\s/.test(after) ? '' : ' ';
    onChange(`${before}${suggestion.command}${separator}${after}`);
    close();

    const cursor = `${before}${suggestion.command} `.length;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [close, onChange, textareaRef, trigger.position, value]);

  /** Returns true when the menu consumed the key, so the caller can stop. */
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!isOpen) {
      return false;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return true;
    }
    if (suggestions.length === 0) {
      return false;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : suggestions.length - 1;
      setActiveIndex((previous) => (previous + step) % suggestions.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      select(suggestions[activeIndex] ?? suggestions[0]);
      return true;
    }

    return false;
  }, [activeIndex, close, isOpen, select, suggestions]);

  return {
    suggestions, isOpen, activeIndex, error, seatCount,
    close, handleValueChange, handleKeyDown, select,
  };
}
