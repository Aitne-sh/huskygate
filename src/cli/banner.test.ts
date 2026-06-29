import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatAlreadyRunning,
  formatNotRunning,
  formatStarted,
  formatStatus,
  formatStopped,
  renderBanner,
  renderByeBanner,
} from './banner.js';

describe('banner', () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    // Force color output for consistent assertions
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

  describe('renderBanner', () => {
    it('includes welcome message, dot-art text, Braille face, and version', () => {
      const output = renderBanner('1.2.3');
      // Welcome message above the art
      expect(output).toContain('Welcome to');
      expect(output).toContain('Dashboard!');
      // Subtitle line contains the project name
      expect(output).toContain('HuskyGate');
      expect(output).toContain('v1.2.3');
      expect(output).toContain('Slack Remote LLM CLI Orchestrator');
      // Braille art uses Unicode Braille characters (U+2800–U+28FF)
      expect(output).toMatch(/[⠀-⣿]/);
      // 24-bit true-colour ANSI codes for face and title text
      expect(output).toContain('\x1b[38;2;');
    });

    it('includes welcome message and Braille art even without color', () => {
      process.env.NO_COLOR = '1';
      const output = renderBanner('1.0.0');
      expect(output).toContain('Welcome to');
      expect(output).toContain('HuskyGate');
      expect(output).toContain('Dashboard!');
      // Braille characters render without ANSI codes
      expect(output).toMatch(/[⠀-⣿]/);
      expect(output).not.toContain('\x1b[');
    });
  });

  describe('renderByeBanner', () => {
    it('includes bye bye message, Braille face, and no version', () => {
      const output = renderByeBanner();
      expect(output).toContain('Bye bye');
      // Braille art uses Unicode Braille characters (U+2800–U+28FF)
      expect(output).toMatch(/[⠀-⣿]/);
      // 24-bit true-colour ANSI codes for face and title text
      expect(output).toContain('\x1b[38;2;');
      // Should NOT include welcome or version info
      expect(output).not.toContain('Welcome');
      expect(output).not.toContain('Orchestrator');
    });

    it('renders without color when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = renderByeBanner();
      expect(output).toContain('Bye bye');
      expect(output).toMatch(/[⠀-⣿]/);
      expect(output).not.toContain('\x1b[');
    });
  });

  describe('formatStarted', () => {
    it('includes service name and details', () => {
      const output = formatStarted('Server', { PID: 1234, Port: 3738 });
      expect(output).toContain('Server started');
      expect(output).toContain('1234');
      expect(output).toContain('3738');
      expect(output).toContain('✓');
    });
  });

  describe('formatStopped', () => {
    it('includes service name and details', () => {
      const output = formatStopped('Dashboard', { PID: 5678 });
      expect(output).toContain('Dashboard stopped');
      expect(output).toContain('5678');
      expect(output).toContain('■');
    });
  });

  describe('formatStatus', () => {
    it('shows running state with green indicator', () => {
      const output = formatStatus('Server', true, { PID: 1111 });
      expect(output).toContain('Server running');
      expect(output).toContain('1111');
      expect(output).toContain('●');
    });

    it('shows not-running state with gray indicator', () => {
      const output = formatStatus('Dashboard', false, {});
      expect(output).toContain('Dashboard not running');
      expect(output).toContain('○');
    });
  });

  describe('formatAlreadyRunning', () => {
    it('includes service name and details', () => {
      const output = formatAlreadyRunning('Dashboard', {
        PID: 4444,
        URL: 'http://localhost:3737',
      });
      expect(output).toContain('Dashboard already running');
      expect(output).toContain('4444');
      expect(output).toContain('http://localhost:3737');
    });
  });

  describe('formatNotRunning', () => {
    it('shows service as not running', () => {
      const output = formatNotRunning('Dashboard');
      expect(output).toContain('Dashboard is not running');
    });
  });

  describe('NO_COLOR / non-TTY', () => {
    it('produces no ANSI escape codes when NO_COLOR is set', () => {
      process.env.NO_COLOR = '1';
      const output = renderBanner('1.0.0');
      expect(output).not.toContain('\x1b[');
    });

    it('produces no ANSI escape codes when stdout is not a TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
      const output = formatStarted('Server', { PID: 1234 });
      expect(output).not.toContain('\x1b[');
    });

    it('still includes content without colors', () => {
      process.env.NO_COLOR = '1';
      const output = formatStarted('Server', { PID: 9999 });
      expect(output).toContain('Server started');
      expect(output).toContain('9999');
    });
  });
});
