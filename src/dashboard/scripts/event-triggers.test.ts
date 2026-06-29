import { describe, expect, it } from 'vitest';
import { eventTriggersScript } from './event-triggers.js';

describe('dashboard event-triggers script', () => {
  const script = eventTriggersScript;

  describe('EVT_PRESETS', () => {
    it('defines all four publisher presets', () => {
      expect(script).toContain('generic: {');
      expect(script).toContain('github: {');
      expect(script).toContain('slack: {');
      expect(script).toContain('jira: {');
    });

    it('sets generic preset to no verification', () => {
      expect(script).toContain("verificationType: 'none'");
    });

    it('sets github preset to hmac-sha256 with correct headers', () => {
      expect(script).toContain("signatureHeader: 'x-hub-signature-256'");
      expect(script).toContain("deliveryIdHeader: 'x-github-delivery'");
      expect(script).toContain("eventNameHeader: 'x-github-event'");
    });

    it('sets slack preset to slack-v0 verification with correct headers', () => {
      expect(script).toContain("signatureHeader: 'x-slack-signature'");
      expect(script).toContain("signaturePrefix: 'v0='");
    });

    it('sets jira preset to hmac-sha256 with correct headers', () => {
      expect(script).toContain("signatureHeader: 'x-hub-signature'");
      expect(script).toContain("deliveryIdHeader: 'x-atlassian-webhook-identifier'");
    });

    it('includes description for each preset', () => {
      expect(script).toContain("description: 'No verification.");
      expect(script).toContain("description: 'GitHub Webhooks with HMAC-SHA256");
      expect(script).toContain("description: 'Slack Events API with v0 signature");
      expect(script).toContain("description: 'Jira Cloud Webhooks with HMAC-SHA256");
    });
  });

  describe('tunnel management', () => {
    it('initializes tunnel state from API', () => {
      expect(script).toContain('function evtInitTunnelState()');
      expect(script).toContain("fetchApi('/api/tunnel/status'");
    });

    it('toggles tunnel via API calls', () => {
      expect(script).toContain('function evtToggleTunnel(enabled)');
      expect(script).toContain("fetchApi('/api/tunnel/start'");
      expect(script).toContain("fetchApi('/api/tunnel/stop'");
    });

    it('updates tunnel status badge', () => {
      expect(script).toContain('function evtUpdateTunnelBadge()');
      expect(script).toContain("'evt-tunnel-status-badge'");
    });

    it('defaults to localhost URL', () => {
      expect(script).toContain("evtLocalPort = '3738'");
      expect(script).toContain("'http://localhost:' + evtLocalPort");
    });

    it('prefers publicUrl from endpoint response', () => {
      expect(script).toContain('endpoint.publicUrl');
    });

    it('updates URL display based on tunnel state', () => {
      expect(script).toContain('function evtUpdateUrlDisplay()');
      expect(script).toContain("'evt-url-value'");
    });
  });

  describe('evtBuildWebhookUrl', () => {
    it('constructs full URL from tunnel URL or localhost', () => {
      expect(script).toContain('function evtBuildWebhookUrl(endpoint)');
      expect(script).toContain("'http://localhost:' + evtLocalPort + path");
    });
  });

  describe('evtCopyWebhookUrl', () => {
    it('copies the built URL to clipboard', () => {
      expect(script).toContain('function evtCopyWebhookUrl(endpointId)');
      expect(script).toContain('navigator.clipboard.writeText');
      expect(script).toContain("toast('Webhook URL copied', 'success')");
    });
  });

  describe('evtVerificationBadge', () => {
    it('assigns badge-disabled class for none', () => {
      expect(script).toContain("var cls = 'badge-disabled'");
    });

    it('assigns badge-bearer class for bearer type', () => {
      expect(script).toContain("if (label === 'bearer') cls = 'badge-bearer'");
    });

    it('assigns badge-slack-v0 class for slack-v0 type', () => {
      expect(script).toContain("if (label === 'slack-v0') cls = 'badge-slack-v0'");
    });

    it('assigns badge-hmac class for hmac-prefixed types', () => {
      expect(script).toContain("if (label.indexOf('hmac') === 0) cls = 'badge-hmac'");
    });
  });

  describe('evtUpdateEndpointFormVisibility', () => {
    it('shows signature prefix row for hmac and slack-v0 verification types', () => {
      expect(script).toContain("verification.indexOf('hmac') === 0 || verification === 'slack-v0'");
    });

    it('calls evtUpdatePresetHelpText on visibility update', () => {
      expect(script).toContain('evtUpdatePresetHelpText()');
    });
  });

  describe('filter and mapping placeholders', () => {
    it('defines filter placeholders for all presets', () => {
      expect(script).toContain('EVT_FILTER_PLACEHOLDERS');
      expect(script).toContain('"body.event.type","eq":"message"');
      expect(script).toContain('"body.webhookEvent","eq":"jira:issue_updated"');
    });

    it('defines mapping placeholders for all presets', () => {
      expect(script).toContain('EVT_MAPPING_PLACEHOLDERS');
      expect(script).toContain('"text":"body.event.text"');
      expect(script).toContain('"issueKey":"body.issue.key"');
    });
  });

  describe('endpoint list rendering', () => {
    it('builds URL via evtBuildWebhookUrl', () => {
      expect(script).toContain('evtBuildWebhookUrl(endpoint)');
    });

    it('renders URL in a styled evt-url-cell container', () => {
      expect(script).toContain('evt-url-cell');
    });

    it('renders a copy button for each endpoint URL', () => {
      expect(script).toContain('evtCopyWebhookUrl');
      expect(script).toContain('EVT_ICON.copy');
    });

    it('renders publisher badge via evtPublisherBadge', () => {
      expect(script).toContain('evtPublisherBadge(endpoint.publisherPreset)');
    });

    it('renders verification badge via evtVerificationBadge', () => {
      expect(script).toContain('evtVerificationBadge(endpoint.verificationType)');
    });
  });

  describe('evtPublisherBadge', () => {
    it('generates a badge with preset-specific class', () => {
      expect(script).toContain('function evtPublisherBadge(preset)');
      expect(script).toContain("'badge-pub-' + (preset || 'generic')");
    });
  });

  describe('evtDescribeEndpointShort', () => {
    it('formats short label as preset + path', () => {
      expect(script).toContain(
        "ep.publisherPreset + ' \u00b7 ' + (ep.path || ep.id.substring(0, 8))",
      );
    });
  });

  describe('secret management', () => {
    it('displays the secret banner', () => {
      expect(script).toContain("getElementById('evt-secret-banner')");
      expect(script).toContain("banner.style.display = 'block'");
    });

    it('supports clipboard copy', () => {
      expect(script).toContain('navigator.clipboard.writeText');
    });
  });

  describe('subscription helpers', () => {
    it('builds subscription payload with targetType triggered_task', () => {
      expect(script).toContain("targetType: 'triggered_task'");
    });

    it('validates filter JSON before sending', () => {
      expect(script).toContain("toast('Filter JSON is invalid', 'error')");
    });

    it('validates context mapping JSON before sending', () => {
      expect(script).toContain("toast('Context Mapping JSON is invalid', 'error')");
    });
  });
});
