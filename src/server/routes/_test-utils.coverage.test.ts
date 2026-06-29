/**
 * Coverage tests for _test-utils — targets uncovered lines 48-50:
 * MockResponse.setHeader method.
 */
import { describe, expect, it } from 'vitest';
import { MockResponse } from './_test-utils.js';

describe('_test-utils coverage', () => {
  // Lines 48-50: MockResponse.setHeader
  it('MockResponse.setHeader stores header values', () => {
    const res = new MockResponse();
    res.setHeader('Content-Type', 'application/json');
    expect(res.headers['Content-Type']).toBe('application/json');

    res.setHeader('X-Custom', 'value');
    expect(res.headers['X-Custom']).toBe('value');
  });
});
