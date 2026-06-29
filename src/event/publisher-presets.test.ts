import { describe, expect, it } from 'vitest';
import { getPublisherPreset, listPublisherPresets } from './publisher-presets.js';

describe('publisher presets', () => {
  it('returns the generic preset with no verification headers', () => {
    expect(getPublisherPreset('generic')).toEqual({
      id: 'generic',
      verificationType: 'none',
      signatureHeader: null,
      signaturePrefix: null,
      deliveryIdHeader: null,
      eventNameHeader: null,
    });
  });

  it('returns the slack preset with slack-v0 verification', () => {
    expect(getPublisherPreset('slack')).toEqual({
      id: 'slack',
      verificationType: 'slack-v0',
      signatureHeader: 'x-slack-signature',
      signaturePrefix: 'v0=',
      deliveryIdHeader: null,
      eventNameHeader: null,
    });
  });

  it('returns the jira preset with hmac-sha256 and atlassian delivery header', () => {
    expect(getPublisherPreset('jira')).toEqual({
      id: 'jira',
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-hub-signature',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-atlassian-webhook-identifier',
      eventNameHeader: null,
    });
  });

  it('lists all known presets', () => {
    const presets = listPublisherPresets();
    expect(presets).toHaveLength(4);
    expect(presets.map((p) => p.id)).toEqual(['generic', 'github', 'slack', 'jira']);
  });
});
