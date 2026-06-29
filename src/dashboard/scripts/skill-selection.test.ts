import { describe, expect, it } from 'vitest';
import { agentsScript } from './agents.js';
import { helpersScript } from './helpers.js';
import { ondemandTasksScript } from './ondemand-tasks.js';
import { orchestratorSettingsScript } from './orchestrator-settings.js';
import { scheduleTasksScript } from './schedule-tasks.js';
import { skillsScript } from './skills.js';
import { triggeredTasksScript } from './triggered-tasks.js';

describe('dashboard skill selection scripts', () => {
  it('loads unified skill catalog entries with canonical SkillRefs', () => {
    expect(helpersScript).toContain('/api/skills/catalog');
    expect(helpersScript).toContain('entry.skillRef');
    expect(helpersScript).toContain(
      "entry.issues[i] && entry.issues[i].code === 'duplicate-dir-name'",
    );
    expect(helpersScript).toContain('value="\' + escapeHtml(skill.skillRef)');
  });

  it('renders tool-scoped skill selectors for task forms', () => {
    expect(scheduleTasksScript).toContain('await ensureAvailableSkills(tool);');
    expect(scheduleTasksScript).toContain("buildSkillsSectionHtml('sched', enabledSkills, tool)");
    expect(ondemandTasksScript).toContain("buildSkillsSectionHtml('qt', enabledSkills, tool)");
    expect(triggeredTasksScript).toContain("buildSkillsSectionHtml('tt', enabledSkills, tool)");
  });

  it('refreshes task skill selectors when the tool changes', () => {
    expect(scheduleTasksScript).toContain(
      "void schedRefreshSkillsSection(readSkillsOnly('sched'))",
    );
    expect(ondemandTasksScript).toContain("void qtRefreshSkillsSection(readSkillsOnly('qt'))");
    expect(triggeredTasksScript).toContain("void ttRefreshSkillsSection(readSkillsOnly('tt'))");
  });

  it('uses unified catalog skills in the agent editor and preserves inherited null state', () => {
    expect(agentsScript).toContain('await ensureAvailableSkills(tool);');
    expect(agentsScript).toContain('skill.skillRef');
    expect(agentsScript).toContain('agentInitialEnabledSkills === null ? null : []');
  });

  it('loads orchestrator skills from the unified catalog without a tool filter', () => {
    expect(orchestratorSettingsScript).toContain('await ensureAvailableSkills();');
    expect(orchestratorSettingsScript).toContain(
      "buildSkillsOnlyHtml('orch-settings', o.enabledSkills || null, null)",
    );
  });

  it('preserves null agent skill snapshots in shared task payload helpers', () => {
    expect(helpersScript).toContain(
      'payload.enabledSkills = agents[i].enabledSkills == null ? null : agents[i].enabledSkills;',
    );
  });

  it('uses unified skills endpoints in the Skills tab without builtin route dependencies', () => {
    const script = skillsScript();
    expect(script).toContain('/api/skills?tool=');
    expect(script).toContain('/api/skills/entry/');
    expect(script).not.toContain('/api/builtin-skills');
  });

  it('preserves masked env values and exposes unified support-file editing in Skills detail', () => {
    const script = skillsScript();
    expect(script).toContain('skillsMaskedValueToken');
    expect(script).toContain('envVars[key] = skillsMaskedValueToken');
    expect(script).toContain('skillsClearEnvVar');
    expect(script).toContain('skillsOpenSupportFileModal');
    expect(script).toContain('/files/');
  });
});
