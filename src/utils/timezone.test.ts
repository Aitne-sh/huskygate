import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOsTimezone,
  isValidTimezone,
  resolveAndValidateTimezone,
  resolveTimezone,
} from './timezone.js';

describe('timezone helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the resolved OS timezone when Intl reports a valid IANA zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
        const timeZone = args[1]?.timeZone ?? 'Asia/Tokyo';
        return {
          resolvedOptions: () => ({ timeZone }),
        } as Intl.DateTimeFormat;
      },
    );

    expect(getOsTimezone()).toBe('Asia/Tokyo');
  });

  it('falls back to UTC when Intl lookup fails', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('broken timezone');
    });

    expect(getOsTimezone()).toBe('UTC');
  });

  it('resolves default-like values to the OS timezone and preserves explicit values', () => {
    const expectedTimezone = getOsTimezone();

    expect(resolveTimezone(undefined)).toBe(expectedTimezone);
    expect(resolveTimezone(null)).toBe(expectedTimezone);
    expect(resolveTimezone('default')).toBe(expectedTimezone);
    expect(resolveTimezone('UTC')).toBe('UTC');
  });

  it('validates timezones and rejects invalid values', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Invalid/Timezone')).toBe(false);
    expect(resolveAndValidateTimezone('UTC')).toBe('UTC');
    expect(() => resolveAndValidateTimezone('Invalid/Timezone')).toThrow(
      'Invalid timezone: Invalid/Timezone',
    );
  });
});
