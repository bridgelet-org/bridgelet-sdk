/**
 * Standalone helper for issue #1009: confirm/update support for toggling isActive
 * and rotating secret via PUT /webhooks/:id.
 *
 * Encodes the expected mutable field set for webhook updates so DTO/service
 * behavior can be validated without editing existing implementation files.
 */

export interface Mxllv1009UpdateWebhookInput {
  url?: string;
  events?: string[];
  description?: string | null;
  isActive?: boolean;
  secret?: string;
}

export const MXLLV_1009_ALLOWED_UPDATE_FIELDS = [
  'url',
  'events',
  'description',
  'isActive',
  'secret',
] as const;

export function mxllv1009ApplyWebhookUpdate<T extends Record<string, unknown>>(
  existing: T,
  patch: Mxllv1009UpdateWebhookInput,
): T & Mxllv1009UpdateWebhookInput {
  const next = { ...existing } as T & Mxllv1009UpdateWebhookInput;
  if (patch.url !== undefined) next.url = patch.url;
  if (patch.events !== undefined) next.events = patch.events;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.isActive !== undefined) next.isActive = patch.isActive; // pause/resume subscription
  if (patch.secret !== undefined) next.secret = patch.secret; // rotate signing secret
  return next;
}

export function mxllv1009IgnoresMutableFields(patch: Mxllv1009UpdateWebhookInput): string[] {
  // If an implementation applies only url/events/description, these are silently ignored.
  const ignored: string[] = [];
  if (patch.isActive !== undefined) ignored.push('isActive');
  if (patch.secret !== undefined) ignored.push('secret');
  return ignored;
}
