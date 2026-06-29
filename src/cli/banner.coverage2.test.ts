/** Coverage2 tests for cli/banner: formatSetupRequired, formatOverviewTable,
 * formatStatusIndicator, formatVersionHeader, formatHint, visualLength, padEndVisual. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatHint,
  formatOverviewTable,
  formatSetupRequired,
  formatStatusIndicator,
  formatVersionHeader,
} from './banner.js';

describe('banner coverage2', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  describe('formatSetupRequired', () => {
    it('shows missing keys without dashboard URL', () => {
      const output = formatSetupRequired(['SLACK_BOT_TOKEN', 'ALLOWED_USER_IDS']);
      expect(output).toContain('Setup required');
      expect(output).toContain('Missing');
      expect(output).toContain('SLACK_BOT_TOKEN');
      expect(output).toContain('ALLOWED_USER_IDS');
      expect(output).toContain('huskygate setup');
      expect(output).toContain('huskygate restart');
      // Should NOT contain dashboard URL
      expect(output).not.toContain('Dashboard started');
    });

    it('shows dashboard URL when provided', () => {
      const output = formatSetupRequired(
        ['SLACK_APP_TOKEN'],
        'http://localhost:3737',
      );
      expect(output).toContain('Setup required');
      expect(output).toContain('SLACK_APP_TOKEN');
      expect(output).toContain('Dashboard started');
      expect(output).toContain('http://localhost:3737');
      expect(output).toContain('huskygate setup');
      expect(output).toContain('huskygate restart');
    });

    it('renders without ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = formatSetupRequired(['KEY1'], 'http://localhost:3737');
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('Setup required');
      expect(output).toContain('KEY1');
    });
  });

  describe('formatOverviewTable', () => {
    it('returns empty string for empty rows', () => {
      const output = formatOverviewTable([]);
      expect(output).toBe('');
    });

    it('renders a bordered table with multiple rows', () => {
      const output = formatOverviewTable([
        ['Server API', 'http://127.0.0.1:3738'],
        ['Platform', 'darwin arm64'],
        ['Data dir', '/tmp/data'],
      ]);
      // Box-drawing characters
      expect(output).toContain('┌');
      expect(output).toContain('┐');
      expect(output).toContain('└');
      expect(output).toContain('┘');
      expect(output).toContain('│');
      expect(output).toContain('┬');
      expect(output).toContain('┴');
      // Content
      expect(output).toContain('Server API');
      expect(output).toContain('http://127.0.0.1:3738');
      expect(output).toContain('Platform');
      expect(output).toContain('darwin arm64');
      expect(output).toContain('Data dir');
      expect(output).toContain('/tmp/data');
    });

    it('handles rows with ANSI color codes in values', () => {
      const coloredValue = '\x1b[32mrunning\x1b[0m';
      const output = formatOverviewTable([['Status', coloredValue]]);
      expect(output).toContain('Status');
      expect(output).toContain('running');
    });

    it('supports custom indent', () => {
      const output = formatOverviewTable([['Key', 'Value']], '    ');
      expect(output).toContain('    ');
    });

    it('renders without ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = formatOverviewTable([['Key', 'Value']]);
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('Key');
      expect(output).toContain('Value');
    });
  });

  describe('formatStatusIndicator', () => {
    it('shows green running indicator with PID', () => {
      const output = formatStatusIndicator(true, 1234);
      expect(output).toContain('running');
      expect(output).toContain('1234');
      expect(output).toContain('●');
    });

    it('shows gray not running indicator', () => {
      const output = formatStatusIndicator(false, null);
      expect(output).toContain('not running');
      expect(output).toContain('○');
    });

    it('shows not running when running=true but pid=null', () => {
      const output = formatStatusIndicator(true, null);
      // Edge case: running but no pid -> falls through to not running
      expect(output).toContain('not running');
    });

    it('renders without ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = formatStatusIndicator(true, 5678);
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('running');
      expect(output).toContain('5678');
    });
  });

  describe('formatVersionHeader', () => {
    it('includes version with emoji prefix', () => {
      const output = formatVersionHeader('2.3.4');
      expect(output).toContain('HuskyGate');
      expect(output).toContain('v2.3.4');
    });

    it('renders without ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = formatVersionHeader('1.0.0');
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('HuskyGate');
      expect(output).toContain('v1.0.0');
    });
  });

  describe('formatHint', () => {
    it('shows action and command', () => {
      const output = formatHint('To stop', 'huskygate stop');
      expect(output).toContain('To stop');
      expect(output).toContain('huskygate stop');
    });

    it('renders without ANSI codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = formatHint('To restart', 'huskygate restart');
      expect(output).not.toContain('\x1b[');
      expect(output).toContain('To restart');
      expect(output).toContain('huskygate restart');
    });
  });
});
