import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Input } from '../../../shared/view/ui';
import type {
  CreateOrgRuleInput,
  Org,
  OrgProfilePolicy,
  ProfileWithStatus,
} from '../types';

import OrgPoliciesSection from './OrgPoliciesSection';
import OrgRulesSection from './OrgRulesSection';

const FALLBACK_THRESHOLD_MIN = 50;
const FALLBACK_THRESHOLD_MAX = 99;

const clampThreshold = (value: number): number => Math.min(
  FALLBACK_THRESHOLD_MAX,
  Math.max(FALLBACK_THRESHOLD_MIN, Math.round(value)),
);

type OrgCardProps = {
  org: Org;
  profiles: ProfileWithStatus[];
  profilesLoading: boolean;
  onUpdate: (orgId: string, input: { name?: string; fallbackThreshold?: number }) => Promise<void>;
  onDelete: (org: Org) => void;
  onAddRule: (orgId: string, input: CreateOrgRuleInput) => Promise<void>;
  onRemoveRule: (orgId: string, ruleId: string) => Promise<void>;
  onSavePolicies: (orgId: string, policies: OrgProfilePolicy[]) => Promise<void>;
};

/**
 * One org: name/threshold committed on blur (no separate save button, unlike
 * the policies list below, since these two fields never need a multi-field
 * review step before writing).
 */
export default function OrgCard({
  org,
  profiles,
  profilesLoading,
  onUpdate,
  onDelete,
  onAddRule,
  onRemoveRule,
  onSavePolicies,
}: OrgCardProps) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState(org.name);
  const [threshold, setThreshold] = useState(org.fallbackThreshold);

  useEffect(() => {
    setName(org.name);
    setThreshold(org.fallbackThreshold);
  }, [org.name, org.fallbackThreshold]);

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === org.name) {
      setName(org.name);
      return;
    }
    try {
      await onUpdate(org.id, { name: trimmed });
    } catch {
      setName(org.name);
    }
  };

  const commitThreshold = async () => {
    const clamped = clampThreshold(threshold);
    setThreshold(clamped);
    if (clamped === org.fallbackThreshold) return;
    try {
      await onUpdate(org.id, { fallbackThreshold: clamped });
    } catch {
      setThreshold(org.fallbackThreshold);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            aria-label={t('orgs.card.nameLabel', { defaultValue: 'Org name' })}
            className="h-8 w-48 font-medium"
          />
          {org.isDefault && (
            <Badge
              variant="secondary"
              className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
            >
              {t('orgs.card.default', { defaultValue: 'Default' })}
            </Badge>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t('orgs.card.fallbackThreshold', { defaultValue: 'Fallback at' })}
            <Input
              type="number"
              min={FALLBACK_THRESHOLD_MIN}
              max={FALLBACK_THRESHOLD_MAX}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
              onBlur={commitThreshold}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="h-8 w-16 text-right"
            />
            %
          </label>
          <Button
            onClick={() => onDelete(org)}
            variant="ghost"
            size="sm"
            disabled={org.isDefault}
            title={org.isDefault
              ? t('orgs.card.deleteDisabled', { defaultValue: 'The default org cannot be deleted.' })
              : t('orgs.card.delete', { defaultValue: 'Delete org' })}
            className="text-red-600 hover:text-red-700 disabled:text-muted-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <OrgRulesSection org={org} onAddRule={onAddRule} onRemoveRule={onRemoveRule} />
      </div>

      <div className="border-t border-border pt-3">
        <OrgPoliciesSection
          org={org}
          profiles={profiles}
          profilesLoading={profilesLoading}
          onSave={onSavePolicies}
        />
      </div>
    </div>
  );
}
