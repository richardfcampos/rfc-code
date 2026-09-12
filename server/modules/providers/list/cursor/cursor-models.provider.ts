import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  sanitizeLeafDirectoryName,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CURSOR_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'auto',
      label: 'auto',
      description: 'Auto',
    },
    {
      value: 'gpt-5.3-codex-low',
      label: 'gpt-5.3-codex-low',
      description: 'Codex 5.3 Low',
    },
    {
      value: 'gpt-5.3-codex-low-fast',
      label: 'gpt-5.3-codex-low-fast',
      description: 'Codex 5.3 Low Fast',
    },
    {
      value: 'gpt-5.3-codex',
      label: 'gpt-5.3-codex',
      description: 'Codex 5.3',
    },
    {
      value: 'gpt-5.3-codex-fast',
      label: 'gpt-5.3-codex-fast',
      description: 'Codex 5.3 Fast',
    },
    {
      value: 'gpt-5.3-codex-high',
      label: 'gpt-5.3-codex-high',
      description: 'Codex 5.3 High',
    },
    {
      value: 'gpt-5.3-codex-high-fast',
      label: 'gpt-5.3-codex-high-fast',
      description: 'Codex 5.3 High Fast',
    },
    {
      value: 'gpt-5.3-codex-xhigh',
      label: 'gpt-5.3-codex-xhigh',
      description: 'Codex 5.3 Extra High',
    },
    {
      value: 'gpt-5.3-codex-xhigh-fast',
      label: 'gpt-5.3-codex-xhigh-fast',
      description: 'Codex 5.3 Extra High Fast',
    },
    {
      value: 'gpt-5.2',
      label: 'gpt-5.2',
      description: 'GPT-5.2',
    },
    {
      value: 'cursor-grok-4.6-high-fast',
      label: 'cursor-grok-4.6-high-fast',
      description: 'Cursor Grok 4.6 Fast',
    },
    {
      value: 'composer-2.5',
      label: 'composer-2.5',
      description: 'Composer 2.5',
    },
    {
      value: 'claude-opus-5-thinking-high',
      label: 'claude-opus-5-thinking-high',
      description: 'Claude Opus 5 1M Thinking',
    },
    {
      value: 'claude-opus-5-thinking-high-fast',
      label: 'claude-opus-5-thinking-high-fast',
      description: 'Claude Opus 5 1M Thinking Fast',
    },
    {
      value: 'gpt-5.6-sol-high',
      label: 'gpt-5.6-sol-high',
      description: 'GPT-5.6 Sol 1M High',
    },
    {
      value: 'gpt-5.6-sol-high-fast',
      label: 'gpt-5.6-sol-high-fast',
      description: 'GPT-5.6 Sol 1M High Fast',
    },
    {
      value: 'gpt-5.6-sol-xhigh',
      label: 'gpt-5.6-sol-xhigh',
      description: 'GPT-5.6 Sol 1M Extra High',
    },
    {
      value: 'gpt-5.6-sol-xhigh-fast',
      label: 'gpt-5.6-sol-xhigh-fast',
      description: 'GPT-5.6 Sol 1M Extra High Fast',
    },
    {
      value: 'claude-fable-5-thinking-high',
      label: 'claude-fable-5-thinking-high',
      description: 'Claude Fable 5 1M Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-thinking-xhigh',
      label: 'claude-fable-5-thinking-xhigh',
      description: 'Claude Fable 5 1M Extra High Thinking (NO ZDR)',
    },
    {
      value: 'cursor-grok-4.5-high',
      label: 'cursor-grok-4.5-high',
      description: 'Cursor Grok 4.5',
    },
    {
      value: 'cursor-grok-4.5-high-fast',
      label: 'cursor-grok-4.5-high-fast',
      description: 'Cursor Grok 4.5 Fast',
    },
    {
      value: 'gemini-3.7-flash-high',
      label: 'gemini-3.7-flash-high',
      description: 'Gemini 3.7 Flash',
    },
    {
      value: 'claude-sonnet-5-thinking-high',
      label: 'claude-sonnet-5-thinking-high',
      description: 'Claude Sonnet 5 1M Thinking',
    },
    {
      value: 'claude-sonnet-5-thinking-xhigh',
      label: 'claude-sonnet-5-thinking-xhigh',
      description: 'Claude Sonnet 5 1M Extra High Thinking',
    },
    {
      value: 'gpt-5.6-luna-high',
      label: 'gpt-5.6-luna-high',
      description: 'GPT-5.6 Luna 1M High',
    },
    {
      value: 'cursor-grok-4.6-low',
      label: 'cursor-grok-4.6-low',
      description: 'Cursor Grok 4.6 Low',
    },
    {
      value: 'cursor-grok-4.6-low-fast',
      label: 'cursor-grok-4.6-low-fast',
      description: 'Cursor Grok 4.6 Low Fast',
    },
    {
      value: 'cursor-grok-4.6-medium',
      label: 'cursor-grok-4.6-medium',
      description: 'Cursor Grok 4.6 Medium',
    },
    {
      value: 'cursor-grok-4.6-medium-fast',
      label: 'cursor-grok-4.6-medium-fast',
      description: 'Cursor Grok 4.6 Medium Fast',
    },
    {
      value: 'cursor-grok-4.6-high',
      label: 'cursor-grok-4.6-high',
      description: 'Cursor Grok 4.6',
    },
    {
      value: 'cursor-grok-4.6-xhigh',
      label: 'cursor-grok-4.6-xhigh',
      description: 'Cursor Grok 4.6 Extra High',
    },
    {
      value: 'cursor-grok-4.6-xhigh-fast',
      label: 'cursor-grok-4.6-xhigh-fast',
      description: 'Cursor Grok 4.6 Extra High Fast',
    },
    {
      value: 'composer-2.5-fast',
      label: 'composer-2.5-fast',
      description: 'Composer 2.5 Fast',
    },
    {
      value: 'claude-opus-5-low',
      label: 'claude-opus-5-low',
      description: 'Claude Opus 5 1M Low',
    },
    {
      value: 'claude-opus-5-low-fast',
      label: 'claude-opus-5-low-fast',
      description: 'Claude Opus 5 1M Low Fast',
    },
    {
      value: 'claude-opus-5-medium',
      label: 'claude-opus-5-medium',
      description: 'Claude Opus 5 1M Medium',
    },
    {
      value: 'claude-opus-5-medium-fast',
      label: 'claude-opus-5-medium-fast',
      description: 'Claude Opus 5 1M Medium Fast',
    },
    {
      value: 'claude-opus-5-high',
      label: 'claude-opus-5-high',
      description: 'Claude Opus 5 1M',
    },
    {
      value: 'claude-opus-5-high-fast',
      label: 'claude-opus-5-high-fast',
      description: 'Claude Opus 5 1M Fast',
    },
    {
      value: 'claude-opus-5-thinking-low',
      label: 'claude-opus-5-thinking-low',
      description: 'Claude Opus 5 1M Low Thinking',
    },
    {
      value: 'claude-opus-5-thinking-low-fast',
      label: 'claude-opus-5-thinking-low-fast',
      description: 'Claude Opus 5 1M Low Thinking Fast',
    },
    {
      value: 'claude-opus-5-thinking-medium',
      label: 'claude-opus-5-thinking-medium',
      description: 'Claude Opus 5 1M Medium Thinking',
    },
    {
      value: 'claude-opus-5-thinking-medium-fast',
      label: 'claude-opus-5-thinking-medium-fast',
      description: 'Claude Opus 5 1M Medium Thinking Fast',
    },
    {
      value: 'claude-opus-5-thinking-xhigh',
      label: 'claude-opus-5-thinking-xhigh',
      description: 'Claude Opus 5 1M Extra High Thinking',
    },
    {
      value: 'claude-opus-5-thinking-xhigh-fast',
      label: 'claude-opus-5-thinking-xhigh-fast',
      description: 'Claude Opus 5 1M Extra High Thinking Fast',
    },
    {
      value: 'claude-opus-5-thinking-max',
      label: 'claude-opus-5-thinking-max',
      description: 'Claude Opus 5 1M Max Thinking',
    },
    {
      value: 'claude-opus-5-thinking-max-fast',
      label: 'claude-opus-5-thinking-max-fast',
      description: 'Claude Opus 5 1M Max Thinking Fast',
    },
    {
      value: 'claude-opus-4-8-low',
      label: 'claude-opus-4-8-low',
      description: 'Claude Opus 4.8 1M Low',
    },
    {
      value: 'claude-opus-4-8-low-fast',
      label: 'claude-opus-4-8-low-fast',
      description: 'Claude Opus 4.8 1M Low Fast',
    },
    {
      value: 'claude-opus-4-8-medium',
      label: 'claude-opus-4-8-medium',
      description: 'Claude Opus 4.8 1M Medium',
    },
    {
      value: 'claude-opus-4-8-medium-fast',
      label: 'claude-opus-4-8-medium-fast',
      description: 'Claude Opus 4.8 1M Medium Fast',
    },
    {
      value: 'claude-opus-4-8-high',
      label: 'claude-opus-4-8-high',
      description: 'Claude Opus 4.8 1M',
    },
    {
      value: 'claude-opus-4-8-high-fast',
      label: 'claude-opus-4-8-high-fast',
      description: 'Claude Opus 4.8 1M Fast',
    },
    {
      value: 'claude-opus-4-8-xhigh',
      label: 'claude-opus-4-8-xhigh',
      description: 'Claude Opus 4.8 1M Extra High',
    },
    {
      value: 'claude-opus-4-8-xhigh-fast',
      label: 'claude-opus-4-8-xhigh-fast',
      description: 'Claude Opus 4.8 1M Extra High Fast',
    },
    {
      value: 'claude-opus-4-8-max',
      label: 'claude-opus-4-8-max',
      description: 'Claude Opus 4.8 1M Max',
    },
    {
      value: 'claude-opus-4-8-max-fast',
      label: 'claude-opus-4-8-max-fast',
      description: 'Claude Opus 4.8 1M Max Fast',
    },
    {
      value: 'claude-opus-4-8-thinking-low',
      label: 'claude-opus-4-8-thinking-low',
      description: 'Claude Opus 4.8 1M Low Thinking',
    },
    {
      value: 'claude-opus-4-8-thinking-low-fast',
      label: 'claude-opus-4-8-thinking-low-fast',
      description: 'Claude Opus 4.8 1M Low Thinking Fast',
    },
    {
      value: 'claude-opus-4-8-thinking-medium',
      label: 'claude-opus-4-8-thinking-medium',
      description: 'Claude Opus 4.8 1M Medium Thinking',
    },
    {
      value: 'claude-opus-4-8-thinking-medium-fast',
      label: 'claude-opus-4-8-thinking-medium-fast',
      description: 'Claude Opus 4.8 1M Medium Thinking Fast',
    },
    {
      value: 'claude-opus-4-8-thinking-high',
      label: 'claude-opus-4-8-thinking-high',
      description: 'Claude Opus 4.8 1M Thinking',
    },
    {
      value: 'claude-opus-4-8-thinking-high-fast',
      label: 'claude-opus-4-8-thinking-high-fast',
      description: 'Claude Opus 4.8 1M Thinking Fast',
    },
    {
      value: 'claude-opus-4-8-thinking-xhigh',
      label: 'claude-opus-4-8-thinking-xhigh',
      description: 'Claude Opus 4.8 1M Extra High Thinking',
    },
    {
      value: 'claude-opus-4-8-thinking-xhigh-fast',
      label: 'claude-opus-4-8-thinking-xhigh-fast',
      description: 'Claude Opus 4.8 1M Extra High Thinking Fast',
    },
    {
      value: 'claude-opus-4-8-thinking-max',
      label: 'claude-opus-4-8-thinking-max',
      description: 'Claude Opus 4.8 1M Max Thinking',
    },
    {
      value: 'claude-opus-4-8-thinking-max-fast',
      label: 'claude-opus-4-8-thinking-max-fast',
      description: 'Claude Opus 4.8 1M Max Thinking Fast',
    },
    {
      value: 'gpt-5.6-sol-none',
      label: 'gpt-5.6-sol-none',
      description: 'GPT-5.6 Sol 1M None',
    },
    {
      value: 'gpt-5.6-sol-none-fast',
      label: 'gpt-5.6-sol-none-fast',
      description: 'GPT-5.6 Sol 1M None Fast',
    },
    {
      value: 'gpt-5.6-sol-low',
      label: 'gpt-5.6-sol-low',
      description: 'GPT-5.6 Sol 1M Low',
    },
    {
      value: 'gpt-5.6-sol-low-fast',
      label: 'gpt-5.6-sol-low-fast',
      description: 'GPT-5.6 Sol 1M Low Fast',
    },
    {
      value: 'gpt-5.6-sol-medium',
      label: 'gpt-5.6-sol-medium',
      description: 'GPT-5.6 Sol 1M',
    },
    {
      value: 'gpt-5.6-sol-medium-fast',
      label: 'gpt-5.6-sol-medium-fast',
      description: 'GPT-5.6 Sol 1M Fast',
    },
    {
      value: 'gpt-5.6-sol-max',
      label: 'gpt-5.6-sol-max',
      description: 'GPT-5.6 Sol 1M Max',
    },
    {
      value: 'gpt-5.6-sol-max-fast',
      label: 'gpt-5.6-sol-max-fast',
      description: 'GPT-5.6 Sol 1M Max Fast',
    },
    {
      value: 'gpt-5.5-none',
      label: 'gpt-5.5-none',
      description: 'GPT-5.5 1M None',
    },
    {
      value: 'gpt-5.5-none-fast',
      label: 'gpt-5.5-none-fast',
      description: 'GPT-5.5 None Fast',
    },
    {
      value: 'gpt-5.5-low',
      label: 'gpt-5.5-low',
      description: 'GPT-5.5 1M Low',
    },
    {
      value: 'gpt-5.5-low-fast',
      label: 'gpt-5.5-low-fast',
      description: 'GPT-5.5 Low Fast',
    },
    {
      value: 'gpt-5.5-medium',
      label: 'gpt-5.5-medium',
      description: 'GPT-5.5 1M',
    },
    {
      value: 'gpt-5.5-medium-fast',
      label: 'gpt-5.5-medium-fast',
      description: 'GPT-5.5 Fast',
    },
    {
      value: 'gpt-5.5-high',
      label: 'gpt-5.5-high',
      description: 'GPT-5.5 1M High',
    },
    {
      value: 'gpt-5.5-high-fast',
      label: 'gpt-5.5-high-fast',
      description: 'GPT-5.5 High Fast',
    },
    {
      value: 'gpt-5.5-extra-high',
      label: 'gpt-5.5-extra-high',
      description: 'GPT-5.5 1M Extra High',
    },
    {
      value: 'gpt-5.5-extra-high-fast',
      label: 'gpt-5.5-extra-high-fast',
      description: 'GPT-5.5 Extra High Fast',
    },
    {
      value: 'claude-fable-5-1-low',
      label: 'claude-fable-5-1-low',
      description: 'Claude Fable 5.1 1M Low (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-medium',
      label: 'claude-fable-5-1-medium',
      description: 'Claude Fable 5.1 1M Medium (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-high',
      label: 'claude-fable-5-1-high',
      description: 'Claude Fable 5.1 1M (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-xhigh',
      label: 'claude-fable-5-1-xhigh',
      description: 'Claude Fable 5.1 1M Extra High (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-max',
      label: 'claude-fable-5-1-max',
      description: 'Claude Fable 5.1 1M Max (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-thinking-low',
      label: 'claude-fable-5-1-thinking-low',
      description: 'Claude Fable 5.1 1M Low Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-thinking-medium',
      label: 'claude-fable-5-1-thinking-medium',
      description: 'Claude Fable 5.1 1M Medium Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-thinking-high',
      label: 'claude-fable-5-1-thinking-high',
      description: 'Claude Fable 5.1 1M Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-thinking-xhigh',
      label: 'claude-fable-5-1-thinking-xhigh',
      description: 'Claude Fable 5.1 1M Extra High Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-1-thinking-max',
      label: 'claude-fable-5-1-thinking-max',
      description: 'Claude Fable 5.1 1M Max Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-low',
      label: 'claude-fable-5-low',
      description: 'Claude Fable 5 1M Low (NO ZDR)',
    },
    {
      value: 'claude-fable-5-medium',
      label: 'claude-fable-5-medium',
      description: 'Claude Fable 5 1M Medium (NO ZDR)',
    },
    {
      value: 'claude-fable-5-high',
      label: 'claude-fable-5-high',
      description: 'Claude Fable 5 1M (NO ZDR)',
    },
    {
      value: 'claude-fable-5-xhigh',
      label: 'claude-fable-5-xhigh',
      description: 'Claude Fable 5 1M Extra High (NO ZDR)',
    },
    {
      value: 'claude-fable-5-max',
      label: 'claude-fable-5-max',
      description: 'Claude Fable 5 1M Max (NO ZDR)',
    },
    {
      value: 'claude-fable-5-thinking-low',
      label: 'claude-fable-5-thinking-low',
      description: 'Claude Fable 5 1M Low Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-thinking-medium',
      label: 'claude-fable-5-thinking-medium',
      description: 'Claude Fable 5 1M Medium Thinking (NO ZDR)',
    },
    {
      value: 'claude-fable-5-thinking-max',
      label: 'claude-fable-5-thinking-max',
      description: 'Claude Fable 5 1M Max Thinking (NO ZDR)',
    },
    {
      value: 'cursor-grok-4.5-low',
      label: 'cursor-grok-4.5-low',
      description: 'Cursor Grok 4.5 Low',
    },
    {
      value: 'cursor-grok-4.5-low-fast',
      label: 'cursor-grok-4.5-low-fast',
      description: 'Cursor Grok 4.5 Low Fast',
    },
    {
      value: 'cursor-grok-4.5-medium',
      label: 'cursor-grok-4.5-medium',
      description: 'Cursor Grok 4.5 Medium',
    },
    {
      value: 'cursor-grok-4.5-medium-fast',
      label: 'cursor-grok-4.5-medium-fast',
      description: 'Cursor Grok 4.5 Medium Fast',
    },
    {
      value: 'gemini-3.8-flash-low',
      label: 'gemini-3.8-flash-low',
      description: 'Gemini 3.8 Flash Low',
    },
    {
      value: 'gemini-3.8-flash-medium',
      label: 'gemini-3.8-flash-medium',
      description: 'Gemini 3.8 Flash Medium',
    },
    {
      value: 'gemini-3.8-flash-high',
      label: 'gemini-3.8-flash-high',
      description: 'Gemini 3.8 Flash High',
    },
    {
      value: 'gemini-3.7-flash-low',
      label: 'gemini-3.7-flash-low',
      description: 'Gemini 3.7 Flash Low',
    },
    {
      value: 'gemini-3.7-flash-medium',
      label: 'gemini-3.7-flash-medium',
      description: 'Gemini 3.7 Flash Medium',
    },
    {
      value: 'muse-spark-1.3-minimal',
      label: 'muse-spark-1.3-minimal',
      description: 'Muse Spark 1.3 1M Minimal',
    },
    {
      value: 'muse-spark-1.3-low',
      label: 'muse-spark-1.3-low',
      description: 'Muse Spark 1.3 1M Low',
    },
    {
      value: 'muse-spark-1.3-medium',
      label: 'muse-spark-1.3-medium',
      description: 'Muse Spark 1.3 1M Medium',
    },
    {
      value: 'muse-spark-1.3-high',
      label: 'muse-spark-1.3-high',
      description: 'Muse Spark 1.3 1M',
    },
    {
      value: 'muse-spark-1.3-xhigh',
      label: 'muse-spark-1.3-xhigh',
      description: 'Muse Spark 1.3 1M Extra High',
    },
    {
      value: 'muse-spark-1.3-max',
      label: 'muse-spark-1.3-max',
      description: 'Muse Spark 1.3 1M Max',
    },
    {
      value: 'gpt-5.6-terra-none',
      label: 'gpt-5.6-terra-none',
      description: 'GPT-5.6 Terra 1M None',
    },
    {
      value: 'gpt-5.6-terra-none-fast',
      label: 'gpt-5.6-terra-none-fast',
      description: 'GPT-5.6 Terra 1M None Fast',
    },
    {
      value: 'gpt-5.6-terra-low',
      label: 'gpt-5.6-terra-low',
      description: 'GPT-5.6 Terra 1M Low',
    },
    {
      value: 'gpt-5.6-terra-low-fast',
      label: 'gpt-5.6-terra-low-fast',
      description: 'GPT-5.6 Terra 1M Low Fast',
    },
    {
      value: 'gpt-5.6-terra-medium',
      label: 'gpt-5.6-terra-medium',
      description: 'GPT-5.6 Terra 1M',
    },
    {
      value: 'gpt-5.6-terra-medium-fast',
      label: 'gpt-5.6-terra-medium-fast',
      description: 'GPT-5.6 Terra 1M Fast',
    },
    {
      value: 'gpt-5.6-terra-high',
      label: 'gpt-5.6-terra-high',
      description: 'GPT-5.6 Terra 1M High',
    },
    {
      value: 'gpt-5.6-terra-high-fast',
      label: 'gpt-5.6-terra-high-fast',
      description: 'GPT-5.6 Terra 1M High Fast',
    },
    {
      value: 'gpt-5.6-terra-xhigh',
      label: 'gpt-5.6-terra-xhigh',
      description: 'GPT-5.6 Terra 1M Extra High',
    },
    {
      value: 'gpt-5.6-terra-xhigh-fast',
      label: 'gpt-5.6-terra-xhigh-fast',
      description: 'GPT-5.6 Terra 1M Extra High Fast',
    },
    {
      value: 'gpt-5.6-terra-max',
      label: 'gpt-5.6-terra-max',
      description: 'GPT-5.6 Terra 1M Max',
    },
    {
      value: 'gpt-5.6-terra-max-fast',
      label: 'gpt-5.6-terra-max-fast',
      description: 'GPT-5.6 Terra 1M Max Fast',
    },
    {
      value: 'claude-sonnet-5-low',
      label: 'claude-sonnet-5-low',
      description: 'Claude Sonnet 5 1M Low',
    },
    {
      value: 'claude-sonnet-5-medium',
      label: 'claude-sonnet-5-medium',
      description: 'Claude Sonnet 5 1M Medium',
    },
    {
      value: 'claude-sonnet-5-high',
      label: 'claude-sonnet-5-high',
      description: 'Claude Sonnet 5 1M',
    },
    {
      value: 'claude-sonnet-5-xhigh',
      label: 'claude-sonnet-5-xhigh',
      description: 'Claude Sonnet 5 1M Extra High',
    },
    {
      value: 'claude-sonnet-5-max',
      label: 'claude-sonnet-5-max',
      description: 'Claude Sonnet 5 1M Max',
    },
    {
      value: 'claude-sonnet-5-thinking-low',
      label: 'claude-sonnet-5-thinking-low',
      description: 'Claude Sonnet 5 1M Low Thinking',
    },
    {
      value: 'claude-sonnet-5-thinking-medium',
      label: 'claude-sonnet-5-thinking-medium',
      description: 'Claude Sonnet 5 1M Medium Thinking',
    },
    {
      value: 'claude-sonnet-5-thinking-max',
      label: 'claude-sonnet-5-thinking-max',
      description: 'Claude Sonnet 5 1M Max Thinking',
    },
    {
      value: 'claude-4.6-sonnet-medium',
      label: 'claude-4.6-sonnet-medium',
      description: 'Claude Sonnet 4.6 1M',
    },
    {
      value: 'claude-4.6-sonnet-medium-thinking',
      label: 'claude-4.6-sonnet-medium-thinking',
      description: 'Claude Sonnet 4.6 1M Thinking',
    },
    {
      value: 'claude-opus-4-7-low',
      label: 'claude-opus-4-7-low',
      description: 'Claude Opus 4.7 1M Low',
    },
    {
      value: 'claude-opus-4-7-low-fast',
      label: 'claude-opus-4-7-low-fast',
      description: 'Claude Opus 4.7 1M Low Fast',
    },
    {
      value: 'claude-opus-4-7-medium',
      label: 'claude-opus-4-7-medium',
      description: 'Claude Opus 4.7 1M Medium',
    },
    {
      value: 'claude-opus-4-7-medium-fast',
      label: 'claude-opus-4-7-medium-fast',
      description: 'Claude Opus 4.7 1M Medium Fast',
    },
    {
      value: 'claude-opus-4-7-high',
      label: 'claude-opus-4-7-high',
      description: 'Claude Opus 4.7 1M High',
    },
    {
      value: 'claude-opus-4-7-high-fast',
      label: 'claude-opus-4-7-high-fast',
      description: 'Claude Opus 4.7 1M High Fast',
    },
    {
      value: 'claude-opus-4-7-xhigh',
      label: 'claude-opus-4-7-xhigh',
      description: 'Claude Opus 4.7 1M',
    },
    {
      value: 'claude-opus-4-7-xhigh-fast',
      label: 'claude-opus-4-7-xhigh-fast',
      description: 'Claude Opus 4.7 1M Fast',
    },
    {
      value: 'claude-opus-4-7-max',
      label: 'claude-opus-4-7-max',
      description: 'Claude Opus 4.7 1M Max',
    },
    {
      value: 'claude-opus-4-7-max-fast',
      label: 'claude-opus-4-7-max-fast',
      description: 'Claude Opus 4.7 1M Max Fast',
    },
    {
      value: 'claude-opus-4-7-thinking-low',
      label: 'claude-opus-4-7-thinking-low',
      description: 'Claude Opus 4.7 1M Low Thinking',
    },
    {
      value: 'claude-opus-4-7-thinking-low-fast',
      label: 'claude-opus-4-7-thinking-low-fast',
      description: 'Claude Opus 4.7 1M Low Thinking Fast',
    },
    {
      value: 'claude-opus-4-7-thinking-medium',
      label: 'claude-opus-4-7-thinking-medium',
      description: 'Claude Opus 4.7 1M Medium Thinking',
    },
    {
      value: 'claude-opus-4-7-thinking-medium-fast',
      label: 'claude-opus-4-7-thinking-medium-fast',
      description: 'Claude Opus 4.7 1M Medium Thinking Fast',
    },
    {
      value: 'claude-opus-4-7-thinking-high',
      label: 'claude-opus-4-7-thinking-high',
      description: 'Claude Opus 4.7 1M High Thinking',
    },
    {
      value: 'claude-opus-4-7-thinking-high-fast',
      label: 'claude-opus-4-7-thinking-high-fast',
      description: 'Claude Opus 4.7 1M High Thinking Fast',
    },
    {
      value: 'claude-opus-4-7-thinking-xhigh',
      label: 'claude-opus-4-7-thinking-xhigh',
      description: 'Claude Opus 4.7 1M Thinking',
    },
    {
      value: 'claude-opus-4-7-thinking-xhigh-fast',
      label: 'claude-opus-4-7-thinking-xhigh-fast',
      description: 'Claude Opus 4.7 1M Thinking Fast',
    },
    {
      value: 'claude-opus-4-7-thinking-max',
      label: 'claude-opus-4-7-thinking-max',
      description: 'Claude Opus 4.7 1M Max Thinking',
    },
    {
      value: 'claude-opus-4-7-thinking-max-fast',
      label: 'claude-opus-4-7-thinking-max-fast',
      description: 'Claude Opus 4.7 1M Max Thinking Fast',
    },
    {
      value: 'gpt-5.4-low',
      label: 'gpt-5.4-low',
      description: 'GPT-5.4 1M Low',
    },
    {
      value: 'gpt-5.4-medium',
      label: 'gpt-5.4-medium',
      description: 'GPT-5.4 1M',
    },
    {
      value: 'gpt-5.4-medium-fast',
      label: 'gpt-5.4-medium-fast',
      description: 'GPT-5.4 Fast',
    },
    {
      value: 'gpt-5.4-high',
      label: 'gpt-5.4-high',
      description: 'GPT-5.4 1M High',
    },
    {
      value: 'gpt-5.4-high-fast',
      label: 'gpt-5.4-high-fast',
      description: 'GPT-5.4 High Fast',
    },
    {
      value: 'gpt-5.4-xhigh',
      label: 'gpt-5.4-xhigh',
      description: 'GPT-5.4 1M Extra High',
    },
    {
      value: 'gpt-5.4-xhigh-fast',
      label: 'gpt-5.4-xhigh-fast',
      description: 'GPT-5.4 Extra High Fast',
    },
    {
      value: 'claude-4.6-opus-high',
      label: 'claude-4.6-opus-high',
      description: 'Claude Opus 4.6 1M',
    },
    {
      value: 'claude-4.6-opus-max',
      label: 'claude-4.6-opus-max',
      description: 'Claude Opus 4.6 1M Max',
    },
    {
      value: 'claude-4.6-opus-high-thinking',
      label: 'claude-4.6-opus-high-thinking',
      description: 'Claude Opus 4.6 1M Thinking',
    },
    {
      value: 'claude-4.6-opus-max-thinking',
      label: 'claude-4.6-opus-max-thinking',
      description: 'Claude Opus 4.6 1M Max Thinking',
    },
    {
      value: 'claude-4.5-opus-high',
      label: 'claude-4.5-opus-high',
      description: 'Claude Opus 4.5',
    },
    {
      value: 'claude-4.5-opus-high-thinking',
      label: 'claude-4.5-opus-high-thinking',
      description: 'Claude Opus 4.5 Thinking',
    },
    {
      value: 'gpt-5.2-low',
      label: 'gpt-5.2-low',
      description: 'GPT-5.2 Low',
    },
    {
      value: 'gpt-5.2-low-fast',
      label: 'gpt-5.2-low-fast',
      description: 'GPT-5.2 Low Fast',
    },
    {
      value: 'gpt-5.2-fast',
      label: 'gpt-5.2-fast',
      description: 'GPT-5.2 Fast',
    },
    {
      value: 'gpt-5.2-high',
      label: 'gpt-5.2-high',
      description: 'GPT-5.2 High',
    },
    {
      value: 'gpt-5.2-high-fast',
      label: 'gpt-5.2-high-fast',
      description: 'GPT-5.2 High Fast',
    },
    {
      value: 'gpt-5.2-xhigh',
      label: 'gpt-5.2-xhigh',
      description: 'GPT-5.2 Extra High',
    },
    {
      value: 'gpt-5.2-xhigh-fast',
      label: 'gpt-5.2-xhigh-fast',
      description: 'GPT-5.2 Extra High Fast',
    },
    {
      value: 'gpt-5.6-luna-none',
      label: 'gpt-5.6-luna-none',
      description: 'GPT-5.6 Luna 1M None',
    },
    {
      value: 'gpt-5.6-luna-none-fast',
      label: 'gpt-5.6-luna-none-fast',
      description: 'GPT-5.6 Luna 1M None Fast',
    },
    {
      value: 'gpt-5.6-luna-low',
      label: 'gpt-5.6-luna-low',
      description: 'GPT-5.6 Luna 1M Low',
    },
    {
      value: 'gpt-5.6-luna-low-fast',
      label: 'gpt-5.6-luna-low-fast',
      description: 'GPT-5.6 Luna 1M Low Fast',
    },
    {
      value: 'gpt-5.6-luna-medium',
      label: 'gpt-5.6-luna-medium',
      description: 'GPT-5.6 Luna 1M',
    },
    {
      value: 'gpt-5.6-luna-medium-fast',
      label: 'gpt-5.6-luna-medium-fast',
      description: 'GPT-5.6 Luna 1M Fast',
    },
    {
      value: 'gpt-5.6-luna-high-fast',
      label: 'gpt-5.6-luna-high-fast',
      description: 'GPT-5.6 Luna 1M High Fast',
    },
    {
      value: 'gpt-5.6-luna-xhigh',
      label: 'gpt-5.6-luna-xhigh',
      description: 'GPT-5.6 Luna 1M Extra High',
    },
    {
      value: 'gpt-5.6-luna-xhigh-fast',
      label: 'gpt-5.6-luna-xhigh-fast',
      description: 'GPT-5.6 Luna 1M Extra High Fast',
    },
    {
      value: 'gpt-5.6-luna-max',
      label: 'gpt-5.6-luna-max',
      description: 'GPT-5.6 Luna 1M Max',
    },
    {
      value: 'gpt-5.6-luna-max-fast',
      label: 'gpt-5.6-luna-max-fast',
      description: 'GPT-5.6 Luna 1M Max Fast',
    },
    {
      value: 'gemini-3.6-flash-minimal',
      label: 'gemini-3.6-flash-minimal',
      description: 'Gemini 3.6 Flash Minimal',
    },
    {
      value: 'gemini-3.6-flash-low',
      label: 'gemini-3.6-flash-low',
      description: 'Gemini 3.6 Flash Low',
    },
    {
      value: 'gemini-3.6-flash-medium',
      label: 'gemini-3.6-flash-medium',
      description: 'Gemini 3.6 Flash Medium',
    },
    {
      value: 'gemini-3.6-flash-high',
      label: 'gemini-3.6-flash-high',
      description: 'Gemini 3.6 Flash',
    },
    {
      value: 'gemini-3.1-pro',
      label: 'gemini-3.1-pro',
      description: 'Gemini 3.1 Pro',
    },
    {
      value: 'gpt-5.4-mini-none',
      label: 'gpt-5.4-mini-none',
      description: 'GPT-5.4 Mini None',
    },
    {
      value: 'gpt-5.4-mini-low',
      label: 'gpt-5.4-mini-low',
      description: 'GPT-5.4 Mini Low',
    },
    {
      value: 'gpt-5.4-mini-medium',
      label: 'gpt-5.4-mini-medium',
      description: 'GPT-5.4 Mini',
    },
    {
      value: 'gpt-5.4-mini-high',
      label: 'gpt-5.4-mini-high',
      description: 'GPT-5.4 Mini High',
    },
    {
      value: 'gpt-5.4-mini-xhigh',
      label: 'gpt-5.4-mini-xhigh',
      description: 'GPT-5.4 Mini Extra High',
    },
    {
      value: 'gpt-5.4-nano-none',
      label: 'gpt-5.4-nano-none',
      description: 'GPT-5.4 Nano None',
    },
    {
      value: 'gpt-5.4-nano-low',
      label: 'gpt-5.4-nano-low',
      description: 'GPT-5.4 Nano Low',
    },
    {
      value: 'gpt-5.4-nano-medium',
      label: 'gpt-5.4-nano-medium',
      description: 'GPT-5.4 Nano',
    },
    {
      value: 'gpt-5.4-nano-high',
      label: 'gpt-5.4-nano-high',
      description: 'GPT-5.4 Nano High',
    },
    {
      value: 'gpt-5.4-nano-xhigh',
      label: 'gpt-5.4-nano-xhigh',
      description: 'GPT-5.4 Nano Extra High',
    },
    {
      value: 'claude-4.5-sonnet',
      label: 'claude-4.5-sonnet',
      description: 'Claude Sonnet 4.5',
    },
    {
      value: 'claude-4.5-sonnet-thinking',
      label: 'claude-4.5-sonnet-thinking',
      description: 'Claude Sonnet 4.5 Thinking',
    },
    {
      value: 'gpt-5.1-low',
      label: 'gpt-5.1-low',
      description: 'GPT-5.1 Low',
    },
    {
      value: 'gpt-5.1',
      label: 'gpt-5.1',
      description: 'GPT-5.1',
    },
    {
      value: 'gpt-5.1-high',
      label: 'gpt-5.1-high',
      description: 'GPT-5.1 High',
    },
    {
      value: 'gemini-3-flash',
      label: 'gemini-3-flash',
      description: 'Gemini 3 Flash',
    },
    {
      value: 'gemini-3.5-flash',
      label: 'gemini-3.5-flash',
      description: 'Gemini 3.5 Flash',
    },
    {
      value: 'claude-4-sonnet',
      label: 'claude-4-sonnet',
      description: 'Claude Sonnet 4',
    },
    {
      value: 'claude-4-sonnet-thinking',
      label: 'claude-4-sonnet-thinking',
      description: 'Claude Sonnet 4 Thinking',
    },
    {
      value: 'gpt-5-mini',
      label: 'gpt-5-mini',
      description: 'GPT-5 Mini',
    },
    {
      value: 'kimi-k3-low',
      label: 'kimi-k3-low',
      description: 'Kimi K3 Low',
    },
    {
      value: 'kimi-k3-high',
      label: 'kimi-k3-high',
      description: 'Kimi K3 High',
    },
    {
      value: 'kimi-k3-max',
      label: 'kimi-k3-max',
      description: 'Kimi K3',
    },
    {
      value: 'kimi-k2.7-code',
      label: 'kimi-k2.7-code',
      description: 'Kimi K2.7 Code',
    },
    {
      value: 'glm-5.2-high',
      label: 'glm-5.2-high',
      description: 'GLM 5.2',
    },
    {
      value: 'glm-5.2-max',
      label: 'glm-5.2-max',
      description: 'GLM 5.2 Max',
    },
  ],
  DEFAULT: 'auto',
};

type CursorModelRow = {
  name: string;
  description: string;
  current: boolean;
  default: boolean;
};

const CURSOR_MODELS_TIMEOUT_MS = 10_000;
const CURSOR_CHATS_ROOT = path.join(os.homedir(), '.cursor', 'chats');
// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;
const ANSI_PATTERN = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const parseModelLine = (line: string): CursorModelRow | null => {
  const trimmed = line.trim();

  if (
    !trimmed
    || trimmed === 'Available models'
    || trimmed.startsWith('Loading models')
    || trimmed.startsWith('Tip:')
  ) {
    return null;
  }

  const match = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) {
    return null;
  }

  const name = match[1].trim();
  let description = match[2].trim();
  const current = /\(current\)/i.test(description);
  const defaultModel = /\(default\)/i.test(description);

  description = description.replace(/\s*\((current|default)\)/gi, '').replace(/\s{2,}/g, ' ').trim();

  return {
    name,
    description,
    current,
    default: defaultModel,
  };
};

const parseModelsOutput = (text: string): CursorModelRow[] => {
  const models: CursorModelRow[] = [];

  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const parsed = parseModelLine(line);
    if (parsed) {
      models.push(parsed);
    }
  }

  return models;
};

const runCursorListModels = (): Promise<string> => new Promise((resolve, reject) => {
  const cursorProcess = spawnFunction('cursor-agent', ['--list-models'], {
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    cursorProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('cursor-agent --list-models timed out'));
    }
  }, CURSOR_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    resolve(output);
  };

  cursorProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  cursorProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  cursorProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  cursorProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `cursor-agent --list-models exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

const buildCursorModelsDefinition = (models: CursorModelRow[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    if (seenValues.has(model.name)) {
      continue;
    }

    seenValues.add(model.name);
    options.push({
      value: model.name,
      label: model.name,
      description: model.description || undefined,
    });
  }

  if (options.length === 0) {
    return CURSOR_FALLBACK_MODELS;
  }

  const defaultValue = models.find((model) => model.default)?.name
    ?? models.find((model) => model.current)?.name
    ?? options[0]?.value
    ?? CURSOR_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

const resolveCursorSessionStorePath = async (sessionId: string): Promise<string | null> => {
  const safeSessionId = sanitizeLeafDirectoryName(sessionId, 'cursor session id');

  try {
    const workspaceEntries = await readdir(CURSOR_CHATS_ROOT, { withFileTypes: true });
    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) {
        continue;
      }

      const storeDbPath = path.join(CURSOR_CHATS_ROOT, workspaceEntry.name, safeSessionId, 'store.db');
      try {
        await access(storeDbPath);
        return storeDbPath;
      } catch {
        // Keep scanning sibling workspaces until the matching session directory is found.
      }
    }
  } catch {
    return null;
  }

  return null;
};

export class CursorProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runCursorListModels();
      const models = parseModelsOutput(stdout);
      return buildCursorModelsDefinition(models);
    } catch {
      return CURSOR_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const storeDbPath = await resolveCursorSessionStorePath(sessionId);
      if (!storeDbPath) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      const { default: Database } = await import('better-sqlite3');
      const db = new Database(storeDbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`SELECT value FROM meta WHERE key='0' LIMIT 1;`).get() as {
          value?: Buffer | string;
        } | undefined;
        const metadataText = Buffer.isBuffer(row?.value)
          ? row.value.toString('utf8')
          : typeof row?.value === 'string' && row.value.trim()
            ? Buffer.from(row.value.trim(), 'hex').toString('utf8')
            : '';
        if (!metadataText) {
          return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
        }

        const metadata = JSON.parse(metadataText) as { lastUsedModel?: string };
        if (typeof metadata.lastUsedModel === 'string' && metadata.lastUsedModel.trim()) {
          return {
            model: metadata.lastUsedModel.trim(),
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the provider default when Cursor metadata cannot be read.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('cursor', input);
  }
}

