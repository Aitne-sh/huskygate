import { describe, expect, it } from 'vitest';
import { resolveAutoApprove } from './auto-approve.js';

function createConfig(toolAutoApproveMode: boolean) {
  return { toolAutoApproveMode };
}

describe('resolveAutoApprove', () => {
  it('returns false for readonly regardless of job/session/global', () => {
    expect(resolveAutoApprove(createConfig(true), 'readonly', true, { auto_approve: true })).toBe(
      false,
    );
    expect(resolveAutoApprove(createConfig(true), 'readonly', undefined, {})).toBe(false);
  });

  it('returns true for write + job override', () => {
    expect(resolveAutoApprove(createConfig(false), 'write', true, {})).toBe(true);
  });

  it('returns true for write + session override', () => {
    expect(
      resolveAutoApprove(createConfig(false), 'write', undefined, { auto_approve: true }),
    ).toBe(true);
  });

  it('returns false for write + session explicit false', () => {
    expect(
      resolveAutoApprove(createConfig(true), 'write', undefined, { auto_approve: false }),
    ).toBe(false);
  });

  it('falls back to global config for write mode', () => {
    expect(resolveAutoApprove(createConfig(true), 'write', undefined, {})).toBe(true);
    expect(resolveAutoApprove(createConfig(false), 'write', undefined, {})).toBe(false);
  });

  it('job override takes priority over session override', () => {
    expect(resolveAutoApprove(createConfig(false), 'write', true, { auto_approve: false })).toBe(
      true,
    );
  });
});
