/**
 * How a seat's model and reasoning effort are read off an untrusted request.
 *
 * The two fields are deliberately not treated alike. The model is the choice
 * that moves cost and quality, and an id the provider does not offer would only
 * announce itself once a turn had already been billed — so it is rejected
 * before anything is persisted. Effort is a refinement of a model that was
 * already accepted, and the Claude runtime already drops a value the chosen
 * model does not take, so rejecting it here would be stricter than the thing it
 * is protecting.
 *
 * Both rules are pure: the catalog arrives as an argument, which is what lets
 * them be tested against a two-model provider that exists nowhere else.
 */

import type { LLMProvider } from '@/shared/types.js';

import { badRequest } from './collab-input-errors.js';
import type { CollabModelCatalog } from './collab-model-catalog.service.js';

/**
 * Returns the model this seat runs on, or `undefined` to leave the CLI's own
 * default in place.
 *
 * A catalog that has not loaded yet is not evidence against an id, so an
 * unknown catalog lets it through: a false 400 on a valid model would be worse
 * than the unchecked case, which is exactly what sending no model already does.
 */
export function readParticipantModel(
  value: unknown,
  provider: LLMProvider,
  catalog: CollabModelCatalog,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(
      `A participant model must be a model id offered by ${provider}.`,
      'PARTICIPANT_MODEL_UNSUPPORTED',
    );
  }

  const model = value.trim();
  if (!model) return undefined;

  const options = catalog.options(provider);
  if (options && !options.some((option) => option.value === model)) {
    throw badRequest(
      `Model "${model}" is not offered by ${provider}. Available: ${options.map((option) => option.value).join(', ')}.`,
      'PARTICIPANT_MODEL_UNSUPPORTED',
    );
  }
  return model;
}

/**
 * Returns the effort this seat runs at, or `undefined` for the model's own
 * default. Effort is only meaningful next to a model: on its own there is
 * nothing to check it against, and the CLI would stay free to pick a model the
 * value was never valid for.
 */
export function readParticipantEffort(
  value: unknown,
  provider: LLMProvider,
  model: string | undefined,
  catalog: CollabModelCatalog,
): string | undefined {
  if (typeof value !== 'string') return undefined;

  const effort = value.trim();
  if (!effort || !model) return undefined;

  const option = catalog.options(provider)?.find((entry) => entry.value === model);
  return option?.effortValues.includes(effort) ? effort : undefined;
}
