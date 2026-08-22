import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import SessionProviderLogo from '../../llm-logo-provider/SessionProviderLogo';
import { ORG_PROFILE_ROLES, type Org, type OrgProfilePolicy, type OrgProfileRole, type ProfileWithStatus } from '../types';

type PolicyRow = {
  profileId: string;
  provider: ProfileWithStatus['provider'];
  profileName: string;
  role: OrgProfileRole | '';
};

const buildRows = (org: Org, profiles: ProfileWithStatus[]): PolicyRow[] => {
  const byPriority = [...org.policies].sort((a, b) => a.priority - b.priority);
  const policyByProfileId = new Map(org.policies.map((policy) => [policy.profileId, policy]));

  const rows: PolicyRow[] = [];
  byPriority.forEach((policy) => {
    const profile = profiles.find((entry) => entry.id === policy.profileId);
    // A policy can outlive its profile if the account was deleted elsewhere;
    // skip it rather than rendering a row with no profile to act on.
    if (!profile) return;
    rows.push({ profileId: profile.id, provider: profile.provider, profileName: profile.name, role: policy.role });
  });
  profiles.forEach((profile) => {
    if (!policyByProfileId.has(profile.id)) {
      rows.push({ profileId: profile.id, provider: profile.provider, profileName: profile.name, role: '' });
    }
  });
  return rows;
};

const rowsToPolicies = (rows: PolicyRow[]): OrgProfilePolicy[] => rows
  .filter((row): row is PolicyRow & { role: OrgProfileRole } => row.role !== '')
  .map((row, index) => ({ profileId: row.profileId, role: row.role, priority: index }));

type OrgPoliciesSectionProps = {
  org: Org;
  profiles: ProfileWithStatus[];
  profilesLoading: boolean;
  onSave: (orgId: string, policies: OrgProfilePolicy[]) => Promise<void>;
};

/**
 * Ordered allow-list of which profiles may run in this org, and in what
 * priority order the recommend/fallback resolver should try them.
 *
 * Reordering swaps any two adjacent rows (not just "allowed" ones) — priority
 * is only assigned to non-empty roles at save time, from their position in
 * the full list. That keeps drag/drop-free up/down controls simple: there is
 * no separate invariant to maintain about allowed rows staying contiguous.
 */
export default function OrgPoliciesSection({ org, profiles, profilesLoading, onSave }: OrgPoliciesSectionProps) {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<PolicyRow[]>(() => buildRows(org, profiles));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // `org` and `profiles` are replaced wholesale after every save/refresh,
    // so a reference change here is exactly the signal to reset local edits.
    setRows(buildRows(org, profiles));
  }, [org, profiles]);

  const setRole = (index: number, role: OrgProfileRole | '') => {
    setRows((previous) => previous.map((row, i) => (i === index ? { ...row, role } : row)));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    setRows((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const isDirty = JSON.stringify(rowsToPolicies(rows)) !== JSON.stringify(
    [...org.policies].sort((a, b) => a.priority - b.priority).map((p, index) => ({ ...p, priority: index })),
  );

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(org.id, rowsToPolicies(rows));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save profile policies');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-foreground">
        {t('orgs.policies.title', { defaultValue: 'Profile policies' })}
      </h4>

      {org.policies.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('orgs.policies.compatNote', {
            defaultValue: 'No policy — every profile is allowed.',
          })}
        </p>
      )}

      {profilesLoading && profiles.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('orgs.policies.loadingProfiles', { defaultValue: 'Loading profiles…' })}
        </p>
      )}

      {!profilesLoading && profiles.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('orgs.policies.noProfiles', { defaultValue: 'No account profiles yet.' })}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((row, index) => (
            <li
              key={row.profileId}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SessionProviderLogo provider={row.provider} className="h-4 w-4 flex-shrink-0" />
                <span className="truncate text-sm text-foreground">{row.profileName}</span>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <select
                  value={row.role}
                  onChange={(event) => setRole(index, event.target.value as OrgProfileRole | '')}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="">{t('orgs.policies.role.none', { defaultValue: 'Not allowed' })}</option>
                  {ORG_PROFILE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`orgs.policies.role.${role}`, { defaultValue: role === 'primary' ? 'Primary' : 'Fallback' })}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => moveRow(index, -1)}
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  className="h-7 w-7 p-0"
                  title={t('orgs.policies.moveUp', { defaultValue: 'Move up' })}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  onClick={() => moveRow(index, 1)}
                  variant="ghost"
                  size="sm"
                  disabled={index === rows.length - 1}
                  className="h-7 w-7 p-0"
                  title={t('orgs.policies.moveDown', { defaultValue: 'Move down' })}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-2">
        {saveError && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
        <Button onClick={handleSave} size="sm" disabled={isSaving || !isDirty}>
          {t('orgs.policies.save', { defaultValue: 'Save policies' })}
        </Button>
      </div>
    </div>
  );
}
