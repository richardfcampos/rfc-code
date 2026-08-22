import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Button, Input } from '../../../shared/view/ui';
import { ORG_RULE_KINDS, type Org, type OrgRuleKind } from '../types';

type OrgRulesSectionProps = {
  org: Org;
  onAddRule: (orgId: string, input: { kind: OrgRuleKind; pattern: string }) => Promise<void>;
  onRemoveRule: (orgId: string, ruleId: string) => Promise<void>;
};

/**
 * Project-matching rules for one org: longest `path_prefix` match wins, then
 * `project_name`, then everything else lands in the default org. See
 * `org-resolver.service.ts` for the exact resolution order this mirrors.
 */
export default function OrgRulesSection({ org, onAddRule, onRemoveRule }: OrgRulesSectionProps) {
  const { t } = useTranslation('settings');
  const [kind, setKind] = useState<OrgRuleKind>('path_prefix');
  const [pattern, setPattern] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = pattern.trim();
    if (!trimmed) {
      setFormError(t('orgs.rules.patternRequired', { defaultValue: 'Pattern is required.' }));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await onAddRule(org.id, { kind, pattern: trimmed });
      setPattern('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to add rule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (ruleId: string) => {
    setRemovingId(ruleId);
    try {
      await onRemoveRule(org.id, ruleId);
    } catch {
      // actionError from useOrgs already surfaces the failure message.
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-foreground">
        {t('orgs.rules.title', { defaultValue: 'Project rules' })}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t('orgs.rules.hint', {
          defaultValue:
            'The longest matching path prefix wins. Projects that match no rule land in the default org.',
        })}
      </p>

      {org.rules.length > 0 && (
        <ul className="space-y-1.5">
          {org.rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="outline" className="flex-shrink-0 text-xs">
                  {t(`orgs.rules.kind.${rule.kind}`, {
                    defaultValue: rule.kind === 'path_prefix' ? 'Path prefix' : 'Project name',
                  })}
                </Badge>
                <span className="truncate text-sm text-foreground">{rule.pattern}</span>
              </div>
              <Button
                onClick={() => handleRemove(rule.id)}
                variant="ghost"
                size="sm"
                disabled={removingId === rule.id}
                className="h-7 w-7 flex-shrink-0 p-0 text-muted-foreground hover:text-red-600"
                title={t('orgs.rules.remove', { defaultValue: 'Remove rule' })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as OrgRuleKind)}
          disabled={isSubmitting}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
        >
          {ORG_RULE_KINDS.map((option) => (
            <option key={option} value={option}>
              {t(`orgs.rules.kind.${option}`, {
                defaultValue: option === 'path_prefix' ? 'Path prefix' : 'Project name',
              })}
            </option>
          ))}
        </select>
        <Input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder={kind === 'path_prefix'
            ? t('orgs.rules.pathPlaceholder', { defaultValue: '/home/user/code/company-a' })
            : t('orgs.rules.namePlaceholder', { defaultValue: 'project-name' })}
          disabled={isSubmitting}
          className="flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isSubmitting}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('orgs.rules.add', { defaultValue: 'Add rule' })}
        </Button>
      </form>
      {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
    </div>
  );
}
