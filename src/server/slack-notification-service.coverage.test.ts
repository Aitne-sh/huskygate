/**
 * Coverage tests for slack-notification-service.ts — targets:
 * - listTargets: user info error fallback (line 53-54)
 * - listTargets: upsertTarget collision with better name (lines 39-41)
 * - listTargets: channels.list error path (line 74)
 * - listTargets: multiple pages (cursor pagination)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlackNotificationService } from './slack-notification-service.js';

type SlackClient = ConstructorParameters<typeof SlackNotificationService>[0];

function makeClient(overrides: Record<string, unknown> = {}): SlackClient {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '1.0', channel: 'C1' }),
    },
    users: {
      info: vi.fn().mockResolvedValue({
        user: { profile: { display_name: 'Display' }, real_name: 'Real' },
      }),
    },
    conversations: {
      list: vi.fn().mockResolvedValue({ channels: [], response_metadata: {} }),
    },
    ...overrides,
  } as unknown as SlackClient;
}

/** Helper to access a nested mock function with proper vi.fn() typing */
function mockFn(obj: unknown): ReturnType<typeof vi.fn> {
  return obj as ReturnType<typeof vi.fn>;
}

describe('SlackNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('postNotification', () => {
    it('posts with threadTs when provided', async () => {
      const client = makeClient();
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const result = await svc.postNotification('C1', 'hello', '1.0');
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: '1.0' }),
      );
      expect(result).toEqual({ ts: '1.0', channel: 'C1' });
    });

    it('posts without threadTs', async () => {
      const client = makeClient();
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      await svc.postNotification('C1', 'hello');
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.not.objectContaining({ thread_ts: expect.anything() }),
      );
    });
  });

  describe('listTargets', () => {
    it('falls back to uid as name when users.info fails', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockRejectedValue(new Error('user not found'));
      const svc = new SlackNotificationService(client, { allowedUserIds: ['U123'] });
      const targets = await svc.listTargets();
      expect(targets).toEqual([{ id: 'U123', name: 'U123', type: 'user' }]);
    });

    it('updates target when better name is found via channel duplicate', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockRejectedValue(new Error('fail'));
      // Simulate the upsertTarget collision: first a uid-name match, then a better name
      // The 'upsertTarget' logic: if existing.name === existing.id && target.name !== target.id
      // This is exercised when user is added with name=id, then channel has same id but better name
      // Actually, this path can't happen across types. Let's test dedup within channels instead.
      mockFn(client.conversations.list).mockResolvedValue({
        channels: [
          { id: 'C1', name: 'C1', is_member: true },
          { id: 'C1', name: 'general', is_member: true },
        ],
        response_metadata: {},
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const targets = await svc.listTargets();
      expect(targets).toHaveLength(1);
      expect(targets[0]?.name).toBe('general');
    });

    it('uses real_name when display_name is empty', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockResolvedValue({
        user: { profile: { display_name: '' }, real_name: 'Real Name' },
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: ['U456'] });
      const targets = await svc.listTargets();
      expect(targets[0]?.name).toBe('Real Name');
    });

    it('falls back to uid when both names are empty', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockResolvedValue({
        user: { profile: { display_name: '' }, real_name: '' },
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: ['U789'] });
      const targets = await svc.listTargets();
      expect(targets[0]?.name).toBe('U789');
    });

    it('lists channels and includes member channels', async () => {
      const client = makeClient();
      mockFn(client.conversations.list).mockResolvedValue({
        channels: [
          { id: 'C1', name: 'general', is_member: true },
          { id: 'C2', name: 'random', is_member: false },
          { id: null, name: 'no-id', is_member: true },
        ],
        response_metadata: {},
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const targets = await svc.listTargets();
      expect(targets).toHaveLength(1);
      expect(targets[0]).toEqual({ id: 'C1', name: 'general', type: 'channel' });
    });

    it('handles conversations.list error gracefully', async () => {
      const client = makeClient();
      mockFn(client.conversations.list).mockRejectedValue(new Error('missing scope'));
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const targets = await svc.listTargets();
      expect(targets).toEqual([]);
    });

    it('paginates channels up to 3 pages', async () => {
      const client = makeClient();
      mockFn(client.conversations.list)
        .mockResolvedValueOnce({
          channels: [{ id: 'C1', name: 'ch1', is_member: true }],
          response_metadata: { next_cursor: 'cursor1' },
        })
        .mockResolvedValueOnce({
          channels: [{ id: 'C2', name: 'ch2', is_member: true }],
          response_metadata: { next_cursor: 'cursor2' },
        })
        .mockResolvedValueOnce({
          channels: [{ id: 'C3', name: 'ch3', is_member: true }],
          response_metadata: {},
        });
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const targets = await svc.listTargets();
      expect(targets).toHaveLength(3);
      expect(client.conversations.list).toHaveBeenCalledTimes(3);
    });

    it('handles null channels array in response', async () => {
      const client = makeClient();
      mockFn(client.conversations.list).mockResolvedValue({
        response_metadata: {},
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: [] });
      const targets = await svc.listTargets();
      expect(targets).toEqual([]);
    });

    it('sorts users before channels, then alphabetically', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockResolvedValue({
        user: { profile: { display_name: 'Zara' } },
      });
      mockFn(client.conversations.list).mockResolvedValue({
        channels: [{ id: 'C1', name: 'alpha', is_member: true }],
        response_metadata: {},
      });
      const svc = new SlackNotificationService(client, { allowedUserIds: ['U1'] });
      const targets = await svc.listTargets();
      expect(targets[0]?.type).toBe('user');
      expect(targets[1]?.type).toBe('channel');
    });

    it('deduplicates user IDs and trims whitespace', async () => {
      const client = makeClient();
      mockFn(client.users.info).mockResolvedValue({
        user: { profile: { display_name: 'Name' } },
      });
      const svc = new SlackNotificationService(client, {
        allowedUserIds: ['U1', ' U1 ', '', '  '],
      });
      const targets = await svc.listTargets();
      expect(targets).toHaveLength(1);
    });
  });
});
