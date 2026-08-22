import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { useOrgs } from '../hooks/useOrgs';
import { useProfiles } from '../hooks/useProfiles';
import type { Org } from '../types';

import OrgCard from './OrgCard';

/**
 * Settings screen for orgs: which projects belong to which company (path/name
 * rules) and which account profiles that company's sessions may use (policy
 * list, primary vs. fallback). Sits beside `ProfilesSettingsTab` in the same
 * Settings navigation — profiles are the accounts, orgs are the rules for
 * where each account is allowed to run.
 */
export default function OrgsSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    orgs,
    isLoading,
    loadError,
    actionError,
    createOrg,
    updateOrg,
    deleteOrg,
    addRule,
    removeRule,
    savePolicies,
  } = useOrgs();
  const { profiles, isLoading: profilesLoading } = useProfiles();

  const [isCreating, setIsCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const resetCreateForm = () => {
    setIsCreating(false);
    setNewOrgName('');
    setCreateError(null);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = newOrgName.trim();
    if (!trimmed) {
      setCreateError(t('orgs.create.nameRequired', { defaultValue: 'Name is required.' }));
      return;
    }

    setIsSubmittingCreate(true);
    setCreateError(null);
    try {
      await createOrg({ name: trimmed });
      resetCreateForm();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create org');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleDelete = async (org: Org) => {
    if (!window.confirm(
      t('orgs.confirmDelete', {
        name: org.name,
        defaultValue: 'Delete org "{{name}}"? Its rules and profile policies are removed.',
      }),
    )) {
      return;
    }

    try {
      await deleteOrg(org.id);
    } catch {
      // actionError from useOrgs already surfaces the failure message.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-lg font-medium text-foreground">
              {t('orgs.title', { defaultValue: 'Orgs' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('orgs.description', {
                defaultValue:
                  'Match projects to a company by path or name, and control which account profiles may run there.',
              })}
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreating(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          {t('orgs.actions.new', { defaultValue: 'New org' })}
        </Button>
      </div>

      {(loadError || actionError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {actionError || loadError}
        </div>
      )}

      {isCreating && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-3 sm:flex-row sm:items-center"
        >
          <Input
            value={newOrgName}
            onChange={(event) => setNewOrgName(event.target.value)}
            placeholder={t('orgs.create.namePlaceholder', { defaultValue: 'e.g. Company A' })}
            autoFocus
            disabled={isSubmittingCreate}
            className="flex-1"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetCreateForm}>
              {t('orgs.create.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" size="sm" disabled={isSubmittingCreate}>
              {t('orgs.create.submit', { defaultValue: 'Create org' })}
            </Button>
          </div>
          {createError && (
            <p className="text-xs text-red-600 dark:text-red-400 sm:basis-full">{createError}</p>
          )}
        </form>
      )}

      <div className="space-y-3">
        {isLoading && orgs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t('orgs.loading', { defaultValue: 'Loading orgs…' })}
          </div>
        )}

        {orgs.map((org) => (
          <OrgCard
            key={org.id}
            org={org}
            profiles={profiles}
            profilesLoading={profilesLoading}
            onUpdate={updateOrg}
            onDelete={handleDelete}
            onAddRule={addRule}
            onRemoveRule={removeRule}
            onSavePolicies={savePolicies}
          />
        ))}

        {!isLoading && orgs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t('orgs.empty', { defaultValue: 'No orgs yet. Create one to scope profiles to a company.' })}
          </div>
        )}
      </div>
    </div>
  );
}
