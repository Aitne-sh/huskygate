/**
 * Coverage tests for task-api-shared — targets uncovered line 49:
 * resolvePatchedTaskUserId when notifyChannelProvided is true but rawNotifyChannel is not a string.
 */
import { describe, expect, it } from 'vitest';
import { resolvePatchedTaskUserId } from './task-api-shared.js';

describe('task-api-shared coverage', () => {
  // Line 49: notifyChannelProvided=true but rawNotifyChannel is not a string (e.g. null)
  // This exercises the branch where normalizeOptionalTaskField receives undefined
  // because typeof rawNotifyChannel !== 'string'.
  it('resolvePatchedTaskUserId with notifyChannel as non-string value', () => {
    // notifyChannel key is present but value is null (not a string)
    const result = resolvePatchedTaskUserId(
      { notifyChannel: null },
      'U_EXISTING_CHANNEL',
    );
    // notifyChannelProvided=true, rawNotifyChannel=null, typeof null !== 'string'
    // effectiveNotifyChannel=undefined, explicitUserId=undefined
    // → resolveTaskUserId(undefined, undefined) → 'dashboard'
    expect(result).toBe('dashboard');
  });

  it('resolvePatchedTaskUserId with notify_channel as numeric value', () => {
    const result = resolvePatchedTaskUserId(
      { notify_channel: 42 },
      'U_EXISTING_CHANNEL',
    );
    expect(result).toBe('dashboard');
  });
});
