import { describe, expect, it } from 'vitest';
import { triggeredTasksScript } from './triggered-tasks.js';

describe('dashboard triggered-tasks script — webhook integration', () => {
  const script = triggeredTasksScript;

  describe('ttToggleWebhookFields', () => {
    it('shows filter and mapping rows when endpoint is selected', () => {
      expect(script).toContain("getElementById('tt-row-filter')");
      expect(script).toContain("getElementById('tt-row-mapping')");
    });

    it('updates trigger placeholders when endpoint is selected', () => {
      expect(script).toContain('evtUpdateTriggerPlaceholders');
    });

    it('looks up the selected endpoint to determine preset', () => {
      expect(script).toContain('evtLookupById(evtEndpoints, ep.value)');
      expect(script).toContain('selectedEp.publisherPreset');
    });
  });

  describe('ttPopulateEndpointDropdown', () => {
    it('formats endpoint option as preset · path', () => {
      expect(script).toContain('ep.publisherPreset');
      expect(script).toContain('ep.path || ep.id.substring(0, 12)');
    });

    it('refreshes endpoints before populating', () => {
      expect(script).toContain('evtRefreshEndpointsOnly()');
    });

    it('calls ttToggleWebhookFields after populating', () => {
      expect(script).toContain('ttToggleWebhookFields()');
    });
  });

  describe('ttResolveEndpointLabel', () => {
    it('resolves endpoint label for triggered_task subscriptions', () => {
      expect(script).toContain("s.targetType === 'triggered_task'");
      expect(script).toContain('evtDescribeEndpointShort(s.endpointId)');
    });
  });
});
