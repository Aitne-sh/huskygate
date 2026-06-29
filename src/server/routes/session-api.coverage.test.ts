/**
 * Coverage tests for session-api — targets uncovered lines 111-112:
 * The `return false` fallthrough when no session route matches.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { MockRequest, MockResponse } from './_test-utils.js';
import { handleSessionApiRoutes } from './session-api.js';

describe('session-api coverage', () => {
  // Lines 111-112: return false when no session route matches
  it('returns false for unmatched path', async () => {
    const ctx = makeTestAppContext();
    const req = new MockRequest('GET', '/api/sessions/unknown-action');
    const res = new MockResponse();
    const handled = await handleSessionApiRoutes(
      ctx,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      '/api/sessions/unknown-action',
    );
    expect(handled).toBe(false);
  });
});
