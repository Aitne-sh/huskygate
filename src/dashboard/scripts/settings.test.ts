import { describe, expect, it } from 'vitest';
import { settingsScript } from './settings.js';

describe('dashboard settings script', () => {
  it('defines a dedicated saveModeSettings handler for the Mode panel', () => {
    const script = settingsScript();

    expect(script).toContain('onclick="saveModeSettings()"');
    expect(script).toContain('async function saveModeSettings()');
    expect(script).not.toContain('var saveModeSettings = saveSettings;');
  });

  it('builds a settings patch for TOOL_AUTO_APPROVE_MODE from mode-panel state', () => {
    const script = settingsScript();

    expect(script).toContain("settingsData[i].key !== 'TOOL_AUTO_APPROVE_MODE'");
    expect(script).toContain(
      "patches.push({ key: 'TOOL_AUTO_APPROVE_MODE', op: 'set', value: currentValue });",
    );
    expect(script).toContain("toast('No changes to save', 'success');");
  });
});
