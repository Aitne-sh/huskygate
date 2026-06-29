import { describe, expect, it } from 'vitest';
import { ICON_CHAT, ICON_CLAUDE, ICON_CODEX, ICON_GEMINI, ICON_LOGO } from './icons.js';

describe('dashboard icons', () => {
  it('exports PNG data URIs for all dashboard icons', () => {
    const icons = [ICON_CLAUDE, ICON_CODEX, ICON_GEMINI, ICON_LOGO, ICON_CHAT];
    for (const icon of icons) {
      expect(icon.startsWith('data:image/png;base64,')).toBe(true);
      expect(icon.length).toBeGreaterThan(200);
    }
  });

  it('keeps icon payloads distinct', () => {
    const uniqueCount = new Set([ICON_CLAUDE, ICON_CODEX, ICON_GEMINI, ICON_LOGO, ICON_CHAT]).size;
    expect(uniqueCount).toBe(5);
  });
});
