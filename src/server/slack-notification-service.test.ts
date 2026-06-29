import { describe, expect, it, vi } from 'vitest';
import { SlackNotificationService } from './slack-notification-service.js';

describe('SlackNotificationService', () => {
  it('posts notifications with optional thread_ts', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456', channel: 'C123' });
    const service = new SlackNotificationService(
      {
        chat: { postMessage },
      } as never,
      { allowedUserIds: [] } as never,
    );

    await expect(service.postNotification('C123', 'hello', '999.000')).resolves.toEqual({
      ts: '123.456',
      channel: 'C123',
    });

    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'hello',
      thread_ts: '999.000',
    });
  });

  it('deduplicates and sorts targets while tolerating channel listing failures', async () => {
    const usersInfo = vi
      .fn()
      .mockResolvedValueOnce({ user: { real_name: 'Bob' } })
      .mockResolvedValueOnce({ user: { profile: { display_name: 'Alice' } } });
    const conversationsList = vi
      .fn()
      .mockResolvedValueOnce({
        channels: [
          { id: 'C2', name: 'zeta', is_member: true },
          { id: 'C1', name: 'alpha', is_member: true },
          { id: 'C2', name: 'zeta', is_member: true },
        ],
        response_metadata: { next_cursor: 'next' },
      })
      .mockRejectedValueOnce(new Error('missing scope'));
    const service = new SlackNotificationService(
      {
        users: { info: usersInfo },
        conversations: { list: conversationsList },
      } as never,
      { allowedUserIds: ['U2', ' U1 ', 'U2', ''] } as never,
    );

    await expect(service.listTargets()).resolves.toEqual([
      { id: 'U1', name: 'Alice', type: 'user' },
      { id: 'U2', name: 'Bob', type: 'user' },
      { id: 'C1', name: 'alpha', type: 'channel' },
      { id: 'C2', name: 'zeta', type: 'channel' },
    ]);

    expect(usersInfo).toHaveBeenCalledTimes(2);
    expect(conversationsList).toHaveBeenCalledTimes(2);
  });
});
