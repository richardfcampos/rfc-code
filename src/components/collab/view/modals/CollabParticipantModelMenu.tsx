// The model and reasoning-effort picker for one seat at the table.
//
// Same interaction as the chat composer's menu — reasoning first, the longer
// model list one click away — and it reuses that menu's rows, headings and
// anchoring so the two never drift apart visually. What it cannot reuse is the
// composer's surface: that one sits at `z-[100]`, and this menu opens from
// inside a modal that portals itself at `z-[10000]`, so a shared surface would
// render the menu behind the form that opened it.
//
// The first entry is always the provider's own default. Picking it sends no
// model at all, which is the behaviour a collaboration had before seats could
// choose and the only honest way to say "whatever this account normally uses".

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { DEFAULT_EFFORT_VALUE } from '../../../chat/constants/providerEffort';
import { useComposerMenuAnchor } from '../../../chat/hooks/useComposerMenuAnchor';
import {
  ComposerMenuHeading,
  ComposerMenuItem,
  ComposerMenuSeparator,
} from '../../../chat/view/subcomponents/ComposerMenuPrimitives';
import { PROVIDER_DEFAULT_MODEL } from '../../types';
import type { ProviderModelOption } from '../../../../types/app';

type CollabParticipantModelMenuProps = {
  /** Labels the trigger for assistive tech, which sees several of these rows. */
  profileName: string;
  model: string;
  modelOptions: ProviderModelOption[];
  modelsLoading: boolean;
  effort: string;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: string) => void;
};

export default function CollabParticipantModelMenu({
  profileName, model, modelOptions, modelsLoading, effort, onSelectModel, onSelectEffort,
}: CollabParticipantModelMenuProps) {
  const { t } = useTranslation('collab');
  const [isOpen, setIsOpen] = useState(false);
  const [isModelSectionOpen, setIsModelSectionOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close);

  // The model list starts collapsed every time, the way the composer shows
  // reasoning first and keeps the longer list one click away.
  useEffect(() => {
    if (!isOpen) {
      setIsModelSectionOpen(false);
    }
  }, [isOpen]);

  const defaultModelLabel = t('form.modelDefault', { defaultValue: 'Default model' });
  const defaultEffortLabel = t('form.effortDefault', { defaultValue: 'Default' });

  const selected = modelOptions.find((option) => option.value === model) ?? null;
  const modelLabel = selected?.label || (model === PROVIDER_DEFAULT_MODEL ? defaultModelLabel : model);
  // Effort belongs to a model: with none picked there is nothing to scope the
  // values to, so the section stays hidden rather than offering a guess.
  const effortValues = selected?.effort?.values ?? [];
  const hasEffortSection = effortValues.length > 0;

  const ariaLabel = t('form.modelMenu', {
    profile: profileName,
    defaultValue: 'Model and reasoning effort for {{profile}}',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          updateAnchor();
          setIsOpen((current) => !current);
        }}
        className="flex h-7 max-w-24 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/40 px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:max-w-44"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="truncate">{modelLabel}</span>
        {hasEffortSection && effort !== DEFAULT_EFFORT_VALUE && (
          <span className="hidden shrink-0 capitalize text-muted-foreground sm:inline">· {effort}</span>
        )}
      </button>

      {isOpen && anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className="fixed z-[10001] min-w-48 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          style={{
            right: anchor.right,
            bottom: anchor.bottom,
            maxHeight: anchor.maxHeight,
            maxWidth: anchor.maxWidth,
          }}
        >
          {hasEffortSection && (
            <>
              <ComposerMenuHeading>
                {t('form.reasoning', { defaultValue: 'Reasoning' })}
              </ComposerMenuHeading>
              {[{ value: DEFAULT_EFFORT_VALUE }, ...effortValues].map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.value === DEFAULT_EFFORT_VALUE ? defaultEffortLabel : option.value}
                  isSelected={option.value === effort}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                  className="capitalize"
                />
              ))}
              <ComposerMenuSeparator />
            </>
          )}

          <ComposerMenuItem
            role="menuitem"
            label={modelLabel}
            isSelected={false}
            onSelect={() => setIsModelSectionOpen((current) => !current)}
            trailing={
              isModelSectionOpen
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            }
            className="text-muted-foreground"
          />

          {isModelSectionOpen && (
            <>
              <ComposerMenuHeading>
                {t('form.model', { defaultValue: 'Model' })}
              </ComposerMenuHeading>
              {modelOptions.length === 0 && modelsLoading && (
                <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                  {t('form.loadingModels', { defaultValue: 'Loading models…' })}
                </p>
              )}
              <ComposerMenuItem
                label={defaultModelLabel}
                description={t('form.modelDefaultHint', {
                  defaultValue: 'Run this account on whatever its CLI already uses.',
                })}
                isSelected={model === PROVIDER_DEFAULT_MODEL}
                onSelect={() => {
                  onSelectModel(PROVIDER_DEFAULT_MODEL);
                  setIsOpen(false);
                }}
              />
              {modelOptions.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  label={option.label || option.value}
                  isSelected={option.value === model}
                  onSelect={() => {
                    onSelectModel(option.value);
                    setIsOpen(false);
                  }}
                />
              ))}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
