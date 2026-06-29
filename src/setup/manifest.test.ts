import { describe, expect, it } from 'vitest';
import { generateManifest, generateManifestJson, generateManifestUrl } from './manifest.js';

describe('generateManifest', () => {
  it('returns valid structure with all required top-level keys', () => {
    const manifest = generateManifest() as Record<string, unknown>;
    expect(manifest).toHaveProperty('display_information');
    expect(manifest).toHaveProperty('features');
    expect(manifest).toHaveProperty('oauth_config');
    expect(manifest).toHaveProperty('settings');
  });

  it('has bot scopes sorted alphabetically', () => {
    const manifest = generateManifest() as {
      oauth_config: { scopes: { bot: string[] } };
    };
    const scopes = manifest.oauth_config.scopes.bot;
    const sorted = [...scopes].sort();
    expect(scopes).toEqual(sorted);
  });

  it('has bot_events sorted alphabetically', () => {
    const manifest = generateManifest() as {
      settings: { event_subscriptions: { bot_events: string[] } };
    };
    const events = manifest.settings.event_subscriptions.bot_events;
    const sorted = [...events].sort();
    expect(events).toEqual(sorted);
  });

  it('has socket_mode_enabled set to true', () => {
    const manifest = generateManifest() as {
      settings: { socket_mode_enabled: boolean };
    };
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });

  it('has interactivity enabled', () => {
    const manifest = generateManifest() as {
      settings: { interactivity: { is_enabled: boolean } };
    };
    expect(manifest.settings.interactivity.is_enabled).toBe(true);
  });

  it('has bot_user always_online', () => {
    const manifest = generateManifest() as {
      features: { bot_user: { always_online: boolean } };
    };
    expect(manifest.features.bot_user.always_online).toBe(true);
  });

  it('uses custom appName and appDescription', () => {
    const manifest = generateManifest({
      appName: 'TestBot',
      appDescription: 'Test description',
    }) as {
      display_information: { name: string; description: string };
      features: {
        assistant_view: { assistant_description: string };
        bot_user: { display_name: string };
      };
    };
    expect(manifest.display_information.name).toBe('TestBot');
    expect(manifest.display_information.description).toBe('Test description');
    expect(manifest.features.bot_user.display_name).toBe('TestBot');
    expect(manifest.features.assistant_view.assistant_description).toContain('TestBot');
  });

  it('includes all 10 required bot scopes', () => {
    const manifest = generateManifest() as {
      oauth_config: { scopes: { bot: string[] } };
    };
    const scopes = manifest.oauth_config.scopes.bot;
    expect(scopes).toContain('assistant:write');
    expect(scopes).toContain('app_mentions:read');
    expect(scopes).toContain('channels:history');
    expect(scopes).toContain('channels:read');
    expect(scopes).toContain('chat:write');
    expect(scopes).toContain('files:read');
    expect(scopes).toContain('files:write');
    expect(scopes).toContain('groups:history');
    expect(scopes).toContain('im:history');
    expect(scopes).toContain('mpim:history');
    expect(scopes).toHaveLength(10);
  });

  it('includes all 3 required bot events', () => {
    const manifest = generateManifest() as {
      settings: { event_subscriptions: { bot_events: string[] } };
    };
    const events = manifest.settings.event_subscriptions.bot_events;
    expect(events).toContain('assistant_thread_started');
    expect(events).toContain('assistant_thread_context_changed');
    expect(events).toContain('message.im');
    expect(events).toHaveLength(3);
  });

  it('is a pure function (no side effects, same output for same input)', () => {
    const a = generateManifest();
    const b = generateManifest();
    expect(a).toEqual(b);
  });
});

describe('generateManifestJson', () => {
  it('returns valid JSON', () => {
    const json = generateManifestJson();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('roundtrips through JSON.parse to same object', () => {
    const json = generateManifestJson();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(generateManifest());
  });
});

describe('generateManifestUrl', () => {
  it('starts with the Slack app creation endpoint', () => {
    const url = generateManifestUrl();
    expect(url).toMatch(/^https:\/\/api\.slack\.com\/apps\?new_app=1&manifest_json=/);
  });

  it('contains URL-encoded manifest that decodes to the same manifest', () => {
    const url = generateManifestUrl();
    const encodedJson = url.split('manifest_json=')[1] ?? '';
    const decodedJson = decodeURIComponent(encodedJson);
    const decoded = JSON.parse(decodedJson);
    expect(decoded).toEqual(generateManifest());
  });

  it('generates a URL under 2000 bytes (safe for all browsers)', () => {
    const url = generateManifestUrl();
    expect(url.length).toBeLessThan(2000);
  });
});
