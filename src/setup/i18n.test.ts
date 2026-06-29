import { describe, expect, it } from 'vitest';
import { getStrings } from './i18n.js';

describe('getStrings', () => {
  it('returns strings with all required keys', () => {
    const s = getStrings();
    expect(s.bannerTitle).toBe('HuskyGate -- First-Time Setup');
    expect(s.step1Title).toBe('Create Slack App');
    expect(s.step2Instruction5).toContain('xoxb-');
    expect(s.step3Instruction8).toContain('xapp-');
  });

  it('all function-type string properties return strings', () => {
    const s = getStrings();
    expect(typeof s.userRegistered(3)).toBe('string');
    expect(typeof s.attemptCount(1, 3)).toBe('string');
    expect(typeof s.failedAfterRetries(3)).toBe('string');
    expect(typeof s.saveFailed('err')).toBe('string');
    expect(typeof s.dbInitFailed('/data', 'err')).toBe('string');
    expect(typeof s.botTokenSaved('keychain')).toBe('string');
    expect(typeof s.appTokenSaved('keychain')).toBe('string');
    expect(typeof s.resetKeychainFailed('err')).toBe('string');
    expect(typeof s.resetDbFailed('err')).toBe('string');
  });

  it('welcome body contains usage instructions', () => {
    const s = getStrings();
    expect(s.welcomeBody).toContain('!help');
    expect(s.welcomeBody).toContain('!menu');
  });
});
