/** @module cron-utils — Cron expression validation and next-run calculation */
import { CronExpressionParser } from 'cron-parser';
import { isValidTimezone } from '../utils/timezone.js';

/**
 * Validate a cron expression string.
 * Returns null if valid, or an error message string.
 */
export function validateCronExpr(expr: string): string | null {
  try {
    CronExpressionParser.parse(expr);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid cron expression';
  }
}

/**
 * Calculate the next run time from a cron expression.
 * Returns an ISO 8601 string or null if no more occurrences.
 *
 * @param cronExpr - Standard 5-field cron (minute, hour, day, month, weekday)
 * @param timezone - IANA timezone identifier
 * @param fromDate - Calculate next run after this date (defaults to now)
 */
export function getNextCronRun(cronExpr: string, timezone: string, fromDate?: Date): string | null {
  if (!isValidTimezone(timezone)) {
    return null;
  }
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: fromDate ?? new Date(),
      tz: timezone,
    });
    const next = interval.next();
    return next.toISOString();
  } catch {
    return null;
  }
}
