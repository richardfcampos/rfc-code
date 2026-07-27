import { useState } from 'react';
import { KeyRound, Plus, Trash2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button } from '../../../shared/view/ui';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import { useProfiles } from '../hooks/useProfiles';
import type { Profile, ProfileWithStatus } from '../types';

import CreateProfileModal from './modals/CreateProfileModal';
import ProfileLoginTerminal from './ProfileLoginTerminal';
import ProfileToolingControls from './ProfileToolingControls';

function ProfileStatusBadge({ profile }: { profile: ProfileWithStatus }) {
  const { t } = useTranslation('settings');

  if (profile.statusLoading) {
    return (
      <Badge variant="secondary" className="bg-muted">
        {t('profiles.status.checking', { defaultValue: 'Checking…' })}
      </Badge>
    );
  }

  if (profile.status?.authenticated) {
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        {t('profiles.status.authenticated', { defaultValue: 'Authenticated' })}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
      {t('profiles.status.needsAuth', { defaultValue: 'Needs re-authentication' })}
    </Badge>
  );
}

export default function ProfilesSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    profiles,
    isLoading,
    loadError,
    actionError,
    createProfile,
    deleteProfile,
    updateToolingModes,
  } = useProfiles();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loginProfile, setLoginProfile] = useState<Profile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (profile: ProfileWithStatus) => {
    if (!window.confirm(
      t('profiles.confirmDelete', {
        name: profile.name,
        defaultValue: 'Delete profile "{{name}}"? Its credentials stay on disk in case you recreate it.',
      }),
    )) {
      return;
    }

    setDeletingId(profile.id);
    try {
      await deleteProfile(profile.id);
    } catch {
      // actionError from the hook already surfaces the failure message.
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-500" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-lg font-medium text-foreground">
              {t('profiles.title', { defaultValue: 'Account profiles' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('profiles.description', {
                defaultValue: 'Register multiple accounts per provider and pick which one a session uses.',
              })}
            </p>
          </div>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          {t('profiles.actions.new', { defaultValue: 'New profile' })}
        </Button>
      </div>

      {(loadError || actionError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200">
          {actionError || loadError}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && profiles.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t('profiles.loading', { defaultValue: 'Loading profiles…' })}
          </div>
        )}

        {profiles.map((profile) => (
          <div key={profile.id} className="rounded-lg border border-border bg-card/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SessionProviderLogo provider={profile.provider} className="h-5 w-5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{profile.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">{profile.provider}</Badge>
                  </div>
                  <div className="mt-1">
                    <ProfileStatusBadge profile={profile} />
                  </div>
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                <Button
                  onClick={() => setLoginProfile(profile)}
                  variant="outline"
                  size="sm"
                  title={t('profiles.actions.authenticate', { defaultValue: 'Authenticate' })}
                >
                  <KeyRound className="mr-1.5 h-4 w-4" />
                  {t('profiles.actions.authenticate', { defaultValue: 'Authenticate' })}
                </Button>
                <Button
                  onClick={() => handleDelete(profile)}
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === profile.id}
                  className="text-red-600 hover:text-red-700"
                  title={t('profiles.actions.delete', { defaultValue: 'Delete' })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-3 border-t border-border pt-3">
              <ProfileToolingControls profile={profile} onChange={updateToolingModes} />
            </div>
          </div>
        ))}

        {!isLoading && profiles.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t('profiles.empty', { defaultValue: 'No profiles yet. Create one to sign in with a second account.' })}
          </div>
        )}
      </div>

      <CreateProfileModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={createProfile}
      />

      <ProfileLoginTerminal
        isOpen={Boolean(loginProfile)}
        profile={loginProfile}
        onClose={() => setLoginProfile(null)}
      />
    </div>
  );
}
