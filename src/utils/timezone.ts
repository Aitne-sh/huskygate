/** @module timezone — IANA timezone detection, resolution, and validation. */

export function getOsTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timezone === 'string' && timezone.length > 0) {
      return timezone;
    }
  } catch {
    /* fall through to UTC */
  }
  return 'UTC';
}

export function resolveTimezone(timezone?: string | null): string {
  if (!timezone || timezone === 'default') {
    return getOsTimezone();
  }
  return timezone;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveAndValidateTimezone(timezone?: string | null): string {
  const resolved = resolveTimezone(timezone);
  if (!isValidTimezone(resolved)) {
    throw new Error(`Invalid timezone: ${resolved}`);
  }
  return resolved;
}
