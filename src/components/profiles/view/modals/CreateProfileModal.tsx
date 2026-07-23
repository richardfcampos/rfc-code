import { useState } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../shared/view/ui';
import type { LLMProvider } from '../../../../types/app';
import type { CreateProfileInput } from '../../types';

const PROVIDERS: LLMProvider[] = ['claude', 'codex', 'cursor', 'opencode'];

type CreateProfileModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateProfileInput) => Promise<void>;
};

export default function CreateProfileModal({ isOpen, onClose, onSubmit }: CreateProfileModalProps) {
  const { t } = useTranslation('settings');
  const [provider, setProvider] = useState<LLMProvider>('claude');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const resetAndClose = () => {
    setProvider('claude');
    setName('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('profiles.form.nameRequired', { defaultValue: 'Name is required.' }));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({ provider, name: trimmedName });
      resetAndClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-lg font-medium text-foreground">
            {t('profiles.form.title', { defaultValue: 'New profile' })}
          </h3>
          <Button variant="ghost" size="sm" onClick={resetAndClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              {t('profiles.form.provider', { defaultValue: 'Provider' })} *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setProvider(option)}
                  className={`rounded-lg px-4 py-2 font-medium capitalize transition-colors ${
                    provider === option
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="profile-name" className="mb-2 block text-sm font-medium text-foreground">
              {t('profiles.form.name', { defaultValue: 'Name' })} *
            </label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('profiles.form.namePlaceholder', { defaultValue: 'e.g. Claude Max — Account A' })}
              autoFocus
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={resetAndClose}>
              {t('profiles.form.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('profiles.form.submit', { defaultValue: 'Create profile' })}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
