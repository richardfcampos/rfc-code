import React from 'react';
import { ShieldAlertIcon } from 'lucide-react';

import type { PendingPermissionRequest } from '../../types/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '../../utils/chatPermissions';
import { getClaudeSettings } from '../../utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '../../tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '../../tools/components/InteractiveRenderers';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationActions,
  ConfirmationAction,
} from '../../../../shared/view/ui';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? 'Allow (saved)' : 'Allow & remember';
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          /* No banner exists in the design exports, so this is built strictly from
             the token system: a calm card carrying a warning wash and a 2px warning
             left edge — the same "needs a decision" signal the session list uses. */
          <Confirmation
            key={request.requestId}
            approval="pending"
            className="rounded-card border border-l-2 border-[var(--warning-line)] border-l-warning bg-[var(--warning-tint)] px-3 py-2.5"
          >
            <ConfirmationTitle className="flex items-start gap-3">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <ConfirmationRequest>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warning">
                    Permission required
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    Tool: <code className="rounded-ctl bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-foreground">{request.toolName}</code>
                  </span>
                </div>
                {permissionEntry && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Allow rule: <code className="rounded-ctl bg-[var(--hover)] px-1 py-0.5 font-mono text-[11px] tracking-wide text-foreground">{permissionEntry}</code>
                  </div>
                )}
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  View tool input
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-ctl border border-border bg-background p-2 font-mono text-[11px] leading-[1.75] tracking-wide text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                onClick={() => {
                  if (permissionEntry && !alreadyAllowed) {
                    handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                  }
                  handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                }}
                disabled={!permissionEntry}
              >
                {rememberLabel}
              </ConfirmationAction>
              <ConfirmationAction
                variant="default"
                onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
              >
                Allow once
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        );
      })}
    </div>
  );
}
