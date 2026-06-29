/**
 * Coverage tests for artifact-api — targets uncovered lines 81-82:
 * The `return false` fallthrough when no route matches.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { MockRequest, MockResponse } from './_test-utils.js';
import { handleArtifactApiRoutes } from './artifact-api.js';

describe('artifact-api coverage', () => {
  // Lines 81-82: return false when no artifact route matches
  it('returns false for unmatched path', async () => {
    const ctx = makeTestAppContext();
    const req = new MockRequest('GET', '/api/chat/abc/something-else');
    const res = new MockResponse();
    const handled = await handleArtifactApiRoutes(
      ctx,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      '/api/chat/abc/something-else',
    );
    expect(handled).toBe(false);
  });
});
