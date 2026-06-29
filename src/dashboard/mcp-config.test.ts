import { describe, expect, it } from 'vitest';
import { MASK } from './env.js';
import { maskMcpSecrets, unmaskMcpSecrets } from './mcp-config.js';

describe('maskMcpSecrets', () => {
  it('masks secret-bearing values in Codex httpHeaders without touching visible headers', () => {
    expect(
      maskMcpSecrets({
        httpHeaders: {
          Authorization: 'Bearer top-secret',
          'X-Trace': 'visible',
          api_key_header: 'another-secret',
        },
        envHttpHeaders: {
          Authorization: 'CODEX_TOKEN',
        },
      }),
    ).toEqual({
      httpHeaders: {
        Authorization: MASK,
        'X-Trace': 'visible',
        api_key_header: MASK,
      },
      envHttpHeaders: {
        Authorization: 'CODEX_TOKEN',
      },
    });
  });

  it('masks snake_case OAuth secrets and env keys', () => {
    expect(
      maskMcpSecrets({
        env: {
          API_KEY: 'secret-key',
          NORMAL_VAR: 'visible',
        },
        oauth: {
          client_secret: 'oauth-secret',
          client_id: 'public-client',
        },
      }),
    ).toEqual({
      env: {
        API_KEY: MASK,
        NORMAL_VAR: 'visible',
      },
      oauth: {
        client_secret: MASK,
        client_id: 'public-client',
      },
    });
  });
});

describe('unmaskMcpSecrets', () => {
  it('preserves masked Codex httpHeaders values on update round-trip', () => {
    expect(
      unmaskMcpSecrets(
        {
          url: 'https://example.com/new',
          httpHeaders: {
            Authorization: MASK,
            'X-Trace': 'changed',
          },
        },
        {
          url: 'https://example.com/old',
          httpHeaders: {
            Authorization: 'Bearer top-secret',
            'X-Trace': 'visible',
          },
        },
      ),
    ).toEqual({
      url: 'https://example.com/new',
      httpHeaders: {
        Authorization: 'Bearer top-secret',
        'X-Trace': 'changed',
      },
    });
  });

  it('throws when a masked top-level secret has no existing value', () => {
    expect(() =>
      unmaskMcpSecrets(
        {
          bearerToken: MASK,
        },
        {},
      ),
    ).toThrow('Invalid masked secret for "bearerToken": no existing value to restore');
  });

  it('throws when a masked nested secret has no existing value', () => {
    expect(() =>
      unmaskMcpSecrets(
        {
          env: {
            NEW_TOKEN: MASK,
          },
        },
        {},
      ),
    ).toThrow('Invalid masked secret for "env.NEW_TOKEN": no existing value to restore');
  });
});
