import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

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
  readObjectRecord,
  readOptionalString,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6-Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low', description: 'Fast responses with lighter reasoning' },
          { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { value: 'high', description: 'Greater reasoning depth for complex problems' },
          { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
          { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
          { value: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low', description: 'Fast responses with lighter reasoning' },
          { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { value: 'high', description: 'Greater reasoning depth for complex problems' },
          { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
          { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
          { value: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6-Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low', description: 'Fast responses with lighter reasoning' },
          { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { value: 'high', description: 'Greater reasoning depth for complex problems' },
          { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
          { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
          { value: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6-Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low', description: 'Fast responses with lighter reasoning' },
          { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { value: 'high', description: 'Greater reasoning depth for complex problems' },
          { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
          { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low', description: 'Fast responses with lighter reasoning' },
          { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
          { value: 'high', description: 'Greater reasoning depth for complex problems' },
          { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
        ],
      },
    },
    {
      value: 'gpt-5.2',
      label: 'GPT-5.2',
      description: 'Optimized for professional work and long-running agents.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low', description: 'Balances speed with some reasoning; useful for straightforward queries and short explanations' },
          { value: 'medium', description: 'Provides a solid balance of reasoning depth and latency for general-purpose tasks' },
          { value: 'high', description: 'Maximizes reasoning depth for complex or ambiguous problems' },
          { value: 'xhigh', description: 'Extra high reasoning for complex problems' },
        ],
      },
    },
  ],
  DEFAULT: 'gpt-6-astra',
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('codex', input);
  }
}
