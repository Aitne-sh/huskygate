/** @module manifest — Slack App Manifest v2 generation for HuskyGate setup. */

export interface ManifestOptions {
  appName?: string;
  appDescription?: string;
}

/**
 * Generate a Slack App Manifest v2 object.
 *
 * The manifest encodes all scopes, events, features, and metadata needed
 * for Socket Mode operation. Scopes and events are kept in sorted order
 * for deterministic output.
 */
export function generateManifest(options?: ManifestOptions): object {
  const name = options?.appName ?? 'HuskyGate';
  const description = options?.appDescription ?? 'Slack Remote LLM CLI Orchestrator';

  return {
    display_information: {
      name,
      description,
      background_color: '#1a1a2e',
    },
    features: {
      assistant_view: {
        assistant_description: `${name} AI Assistant — run Claude, Codex, and Gemini from Slack`,
      },
      bot_user: {
        display_name: name,
        always_online: true,
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          'app_mentions:read',
          'assistant:write',
          'channels:history',
          'channels:read',
          'chat:write',
          'files:read',
          'files:write',
          'groups:history',
          'im:history',
          'mpim:history',
        ],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ['assistant_thread_context_changed', 'assistant_thread_started', 'message.im'],
      },
      interactivity: {
        is_enabled: true,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
    },
  };
}

/** Generate the manifest as a JSON string. */
export function generateManifestJson(options?: ManifestOptions): string {
  return JSON.stringify(generateManifest(options));
}

/**
 * Generate the Slack App creation URL with the manifest pre-filled.
 *
 * The encoded manifest is ~850 bytes, well within browser URL limits
 * (Chrome: 2MB, Firefox: 65KB, Safari: 80KB).
 */
export function generateManifestUrl(options?: ManifestOptions): string {
  const json = generateManifestJson(options);
  const encoded = encodeURIComponent(json);
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encoded}`;
}
