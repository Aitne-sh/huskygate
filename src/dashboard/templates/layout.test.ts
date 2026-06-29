import { describe, expect, it } from 'vitest';
import { layoutHtml } from './layout.js';

const escapeHtml = (s: string) => s;

describe('dashboard layout template — webhook preset UI', () => {
  const html = layoutHtml({ version: '0.0.0-test' }, escapeHtml);

  describe('publisher preset dropdown', () => {
    it('contains all four preset options', () => {
      expect(html).toContain('<option value="generic">generic</option>');
      expect(html).toContain('<option value="github">github</option>');
      expect(html).toContain('<option value="slack">slack</option>');
      expect(html).toContain('<option value="jira">jira</option>');
    });

    it('calls evtApplyEndpointPreset on change', () => {
      expect(html).toContain('onchange="evtApplyEndpointPreset()"');
    });

    it('has a help text element with id for dynamic updates', () => {
      expect(html).toContain('id="evt-endpoint-preset-help"');
    });
  });

  describe('verification type dropdown', () => {
    it('contains all five verification type options', () => {
      expect(html).toContain('<option value="none">none</option>');
      expect(html).toContain('<option value="hmac-sha256">hmac-sha256</option>');
      expect(html).toContain('<option value="hmac-sha1">hmac-sha1</option>');
      expect(html).toContain('<option value="bearer">bearer</option>');
      expect(html).toContain('<option value="slack-v0">slack-v0</option>');
    });

    it('calls evtUpdateEndpointFormVisibility on change', () => {
      expect(html).toContain('onchange="evtUpdateEndpointFormVisibility()"');
    });
  });

  describe('endpoint form fields', () => {
    it('has a secret input field', () => {
      expect(html).toContain('id="evt-endpoint-input-secret"');
    });

    it('has a signature header input field', () => {
      expect(html).toContain('id="evt-endpoint-input-signature-header"');
    });

    it('has a signature prefix input field', () => {
      expect(html).toContain('id="evt-endpoint-input-signature-prefix"');
    });

    it('has a delivery ID header input field', () => {
      expect(html).toContain('id="evt-endpoint-input-delivery-id-header"');
    });

    it('has an event name header input field', () => {
      expect(html).toContain('id="evt-endpoint-input-event-name-header"');
    });

    it('has max body bytes input with correct range', () => {
      expect(html).toContain('id="evt-endpoint-input-max-body-bytes"');
      expect(html).toContain('min="65536"');
      expect(html).toContain('max="1048576"');
    });

    it('has an enabled checkbox', () => {
      expect(html).toContain('id="evt-endpoint-input-enabled"');
    });
  });

  describe('triggered task webhook fields', () => {
    it('has an endpoint dropdown', () => {
      expect(html).toContain('id="tt-input-endpoint"');
    });

    it('has a filter JSON textarea', () => {
      expect(html).toContain('id="tt-input-filter-json"');
    });

    it('has a context mapping JSON textarea', () => {
      expect(html).toContain('id="tt-input-mapping-json"');
    });

    it('toggles webhook fields on endpoint change', () => {
      expect(html).toContain('onchange="ttToggleWebhookFields()"');
    });
  });

  describe('payload URL config bar', () => {
    it('uses styled evt-url-bar container', () => {
      expect(html).toContain('class="evt-url-bar"');
    });

    it('has a URL value display element', () => {
      expect(html).toContain('id="evt-url-value"');
    });

    it('has a Cloudflare Tunnel toggle', () => {
      expect(html).toContain('id="evt-tunnel-checkbox"');
      expect(html).toContain('onchange="evtToggleTunnel(this.checked)"');
    });

    it('has a tunnel status badge', () => {
      expect(html).toContain('id="evt-tunnel-status-badge"');
    });

    it('has a docs link to Cloudflare documentation', () => {
      expect(html).toContain('class="evt-tunnel-docs-btn"');
      expect(html).toContain('developers.cloudflare.com');
    });

    it('has a styled tunnel bar container', () => {
      expect(html).toContain('class="evt-tunnel-bar"');
    });
  });

  describe('secret banner', () => {
    it('has secret banner elements', () => {
      expect(html).toContain('id="evt-secret-banner"');
      expect(html).toContain('id="evt-secret-value"');
      expect(html).toContain('id="evt-secret-title"');
    });

    it('has copy and dismiss buttons', () => {
      expect(html).toContain('onclick="evtCopySecret()"');
      expect(html).toContain('onclick="evtHideSecret()"');
    });
  });
});
