/** Coverage tests for cli/banner: formatAlreadyRunningWithHint, formatRestarted, no-color paths. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatAlreadyRunningWithHint,
  formatRestarted,
  formatStarted,
  formatStopped,
  renderBanner,
  renderByeBanner,
} from './banner.js';

describe('banner coverage', () => {
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

  describe('formatAlreadyRunningWithHint', () => {
    it('includes restart and force hints', () => {
      const output = formatAlreadyRunningWithHint(
        'Server',
        { PID: 1234 },
        { restart: 'huskygate restart', force: 'huskygate start --force' },
      );
      expect(output).toContain('Server already running');
      expect(output).toContain('1234');
      expect(output).toContain('huskygate restart');
      expect(output).toContain('huskygate start --force');
    });

    it('works with only restart hint', () => {
      const output = formatAlreadyRunningWithHint(
        'Dashboard',
        { PID: 5678 },
        { restart: 'restart cmd' },
      );
      expect(output).toContain('Dashboard already running');
      expect(output).toContain('restart cmd');
      expect(output).not.toContain('force');
    });

    it('works with only force hint', () => {
      const output = formatAlreadyRunningWithHint(
        'Dashboard',
        { PID: 5678 },
        { force: 'force cmd' },
      );
      expect(output).toContain('Dashboard already running');
      expect(output).toContain('force cmd');
    });

    it('works with no hints', () => {
      const output = formatAlreadyRunningWithHint('Server', { PID: 1 }, {});
      expect(output).toContain('Server already running');
    });
  });

  describe('formatRestarted', () => {
    it('includes service name, details, and hint', () => {
      const output = formatRestarted('Server', { PID: 9999 }, 'huskygate stop');
      expect(output).toContain('Server restarted');
      expect(output).toContain('9999');
      expect(output).toContain('huskygate stop');
    });

    it('works without hint', () => {
      const output = formatRestarted('Dashboard', { PID: 7777, URL: 'http://localhost:3737' });
      expect(output).toContain('Dashboard restarted');
      expect(output).toContain('7777');
      expect(output).toContain('http://localhost:3737');
    });
  });

  describe('formatStarted with hint', () => {
    it('includes hint', () => {
      const output = formatStarted('Server', { PID: 1234 }, 'huskygate stop');
      expect(output).toContain('To stop');
      expect(output).toContain('huskygate stop');
    });
  });

  describe('formatStopped with hint', () => {
    it('includes restart hint', () => {
      const output = formatStopped('Server', { PID: 1234 }, 'huskygate start');
      expect(output).toContain('To restart');
      expect(output).toContain('huskygate start');
    });
  });

  describe('no-color rendering', () => {
    it('renderBanner without color still contains content', () => {
      process.env.NO_COLOR = '1';
      const output = renderBanner('2.0.0');
      expect(output).toContain('HuskyGate');
      expect(output).toContain('v2.0.0');
      expect(output).not.toContain('\x1b[38;2;');
    });

    it('renderByeBanner without color', () => {
      process.env.NO_COLOR = '1';
      const output = renderByeBanner();
      expect(output).toContain('Bye bye');
      expect(output).not.toContain('\x1b[38;2;');
    });

    it('formatRestarted without color', () => {
      process.env.NO_COLOR = '1';
      const output = formatRestarted('Server', { PID: 111 });
      expect(output).toContain('Server restarted');
      expect(output).not.toContain('\x1b[');
    });

    it('formatAlreadyRunningWithHint without color', () => {
      process.env.NO_COLOR = '1';
      const output = formatAlreadyRunningWithHint('Server', { PID: 222 }, { restart: 'cmd' });
      expect(output).toContain('Server already running');
      expect(output).not.toContain('\x1b[');
    });

    it('non-TTY produces no escape codes', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
      const output = renderBanner('1.0.0');
      expect(output).not.toContain('\x1b[');
    });
  });
});
