import {
  Brain,
  Eye,
  Languages,
  Mic,
} from 'lucide-react';

import type { PreferenceToggleItem } from './types';

export const HANDLE_POSITION_STORAGE_KEY = 'quickSettingsHandlePosition';

export const DEFAULT_HANDLE_POSITION = 50;
export const HANDLE_POSITION_MIN = 10;
export const HANDLE_POSITION_MAX = 90;
export const DRAG_THRESHOLD_PX = 5;

export const SETTING_ROW_CLASS =
  'flex items-center justify-between p-3 rounded-ctl bg-muted/60 hover:bg-accent transition-colors duration-150 ease-out border border-transparent hover:border-border';

export const TOGGLE_ROW_CLASS = `${SETTING_ROW_CLASS} cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`;

export const CHECKBOX_CLASS =
  'h-4 w-4 rounded-ctl border-border bg-card text-primary checked:bg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
];

export const INPUT_SETTING_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'sendByCtrlEnter',
    labelKey: 'quickSettings.sendByCtrlEnter',
    icon: Languages,
  },
  {
    key: 'voiceEnabled',
    labelKey: 'quickSettings.voiceEnabled',
    icon: Mic,
  },
];
