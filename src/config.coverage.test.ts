import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const BASE_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  ALLOWED_USER_IDS: 'U1,U2',
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys({ ...BASE_ENV, ...overrides })) {
    saved[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(BASE_ENV)) {
      process.env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('config coverage', () => {
  it('rejects SERVER_API_PORT values above 65535', () => {
    withEnv({ SERVER_API_PORT: '70000' }, () => {
      expect(() => loadConfig()).toThrow('Invalid SERVER_API_PORT: "70000". Must be <= 65535.');
    });
  });
});
