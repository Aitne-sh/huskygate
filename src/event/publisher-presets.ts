/** @module publisher-presets — Webhook publisher preset definitions (generic, GitHub) with signature config */
import type { PublisherPreset, VerificationType } from './types.js';

export interface PublisherPresetDefinition {
  id: PublisherPreset;
  verificationType: VerificationType;
  signatureHeader: string | null;
  signaturePrefix: string | null;
  deliveryIdHeader: string | null;
  eventNameHeader: string | null;
}

const PRESETS: Record<PublisherPreset, PublisherPresetDefinition> = {
  generic: {
    id: 'generic',
    verificationType: 'none',
    signatureHeader: null,
    signaturePrefix: null,
    deliveryIdHeader: null,
    eventNameHeader: null,
  },
  github: {
    id: 'github',
    verificationType: 'hmac-sha256',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    deliveryIdHeader: 'x-github-delivery',
    eventNameHeader: 'x-github-event',
  },
  slack: {
    id: 'slack',
    verificationType: 'slack-v0',
    signatureHeader: 'x-slack-signature',
    signaturePrefix: 'v0=',
    deliveryIdHeader: null,
    eventNameHeader: null,
  },
  jira: {
    id: 'jira',
    verificationType: 'hmac-sha256',
    signatureHeader: 'x-hub-signature',
    signaturePrefix: 'sha256=',
    deliveryIdHeader: 'x-atlassian-webhook-identifier',
    eventNameHeader: null,
  },
};

export function getPublisherPreset(id: PublisherPreset): PublisherPresetDefinition {
  return PRESETS[id];
}

export function listPublisherPresets(): PublisherPresetDefinition[] {
  return Object.values(PRESETS);
}
