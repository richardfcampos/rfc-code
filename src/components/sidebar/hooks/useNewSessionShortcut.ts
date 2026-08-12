import { useEffect } from 'react';

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
};

/**
 * `N` starts a new session — the shortcut advertised by the badge on the
 * sidebar button. Ignored while the user types or holds a modifier, so it
 * never competes with the composer or the command palette.
 */
export function useNewSessionShortcut(enabled: boolean, onTrigger: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      // A modal owns the keyboard while it is open — creating a session behind
      // it would act on a surface the user can't see.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      event.preventDefault();
      onTrigger();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onTrigger]);
}
