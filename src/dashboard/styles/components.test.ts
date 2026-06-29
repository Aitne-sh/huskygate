import { describe, expect, it } from 'vitest';
import { componentStyles } from './components.js';
import { pageStyles } from './pages.js';

describe('dashboard component styles', () => {
  const css = componentStyles;

  describe('verification badges', () => {
    it('defines badge-disabled style', () => {
      expect(css).toContain('.badge-disabled');
    });

    it('defines badge-bearer style', () => {
      expect(css).toContain('.badge-bearer');
    });

    it('defines badge-hmac style', () => {
      expect(css).toContain('.badge-hmac');
    });

    it('defines badge-slack-v0 style with Slack brand color', () => {
      expect(css).toContain('.badge-slack-v0');
      expect(css).toContain('#611f69');
    });

    it('defines badge-enabled style', () => {
      expect(css).toContain('.badge-enabled');
    });
  });

  describe('publisher preset badges', () => {
    it('defines badge-pub-github style', () => {
      expect(css).toContain('.badge-pub-github');
      expect(css).toContain('#24292f');
    });

    it('defines badge-pub-slack style', () => {
      expect(css).toContain('.badge-pub-slack');
    });

    it('defines badge-pub-jira style', () => {
      expect(css).toContain('.badge-pub-jira');
      expect(css).toContain('#0052cc');
    });

    it('defines badge-pub-generic style', () => {
      expect(css).toContain('.badge-pub-generic');
    });
  });
});

describe('dashboard page styles', () => {
  const css = pageStyles;

  describe('payload URL bar and tunnel', () => {
    it('defines evt-url-bar layout', () => {
      expect(css).toContain('.evt-url-bar');
    });

    it('defines tunnel bar styles', () => {
      expect(css).toContain('.evt-tunnel-bar');
      expect(css).toContain('.evt-tunnel-toggle');
      expect(css).toContain('.evt-tunnel-slider');
    });

    it('defines tunnel status badge styles', () => {
      expect(css).toContain('.evt-tunnel-status');
      expect(css).toContain('.evt-tunnel-status-active');
      expect(css).toContain('.evt-tunnel-status-pending');
    });

    it('defines tunnel docs button style', () => {
      expect(css).toContain('.evt-tunnel-docs-btn');
    });

    it('defines styled URL cell for endpoint list', () => {
      expect(css).toContain('.evt-url-cell');
    });

    it('defines tunnel-active URL style', () => {
      expect(css).toContain('.evt-url-tunnel');
    });

    it('defines hover effect on copy button in URL cell', () => {
      expect(css).toContain('.evt-url-cell:hover .action-btn');
    });
  });
});
