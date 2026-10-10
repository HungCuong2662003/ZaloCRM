import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: {
  conversation: { findMany: vi.fn() },
  message: { findMany: vi.fn() },
  groupLinkDiscovery: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  groupLinkCrawlState: { upsert: vi.fn() },
  zaloGroupLink: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
} }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: { getGroupLinkInfo: vi.fn() } }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: vi.fn(),
  checkAccess: vi.fn(),
  getAccessibleZaloAccountIds: vi.fn().mockResolvedValue(['account-a', 'account-b']),
  handleError: vi.fn((_reply, err) => { throw err; }),
}));

const { classifyLink, extractLinkCandidates, parseJoinDelayRange, groupAudienceRoutes } = await import('../src/modules/zalo/group-audience-routes.js');
const { prisma } = await import('../src/shared/database/prisma-client.js');
const { zaloOps } = await import('../src/shared/zalo-operations.js');

describe('group link discovery parser', () => {
  it('extracts Zalo links from JSON-escaped message content', () => {
    const links = extractLinkCandidates('{"href":"https:\\/\\/zalo.me\\/g\\/fyiueu911"}');

    expect(links).toContain('https://zalo.me/g/fyiueu911');
    expect(classifyLink(links[0])).toMatchObject({
      platform: 'zalo',
      normalizedUrl: 'https://zalo.me/g/fyiueu911',
      externalKey: 'fyiueu911',
    });
  });

  it('validates auto-join delay range', () => {
    expect(parseJoinDelayRange({ delayMinSeconds: 30, delayMaxSeconds: 90 })).toEqual({
      delayMinMs: 30000,
      delayMaxMs: 90000,
    });
    expect(parseJoinDelayRange({ delayMinSeconds: 5, delayMaxSeconds: 90 })).toBeNull();
    expect(parseJoinDelayRange({ delayMinSeconds: 90, delayMaxSeconds: 30 })).toBeNull();
  });

  it('skips saved links, checks unchecked links once, and keeps discovery scoped to each account', async () => {
    const existing = 'https://zalo.me/g/existing123';
    const unchecked = 'https://zalo.me/g/unchecked123';
    const fresh = 'https://zalo.me/g/fresh123';
    const conversation = { id: 'conversation-a', zaloAccountId: 'account-a', externalThreadId: 'group-a', groupName: 'Test' };
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([conversation] as any);
    vi.mocked(prisma.message.findMany).mockResolvedValue([
      { id: 'message-a', conversationId: conversation.id, conversation, sentAt: new Date(), content: `${existing} ${unchecked} ${fresh}` },
      { id: 'message-b', conversationId: conversation.id, conversation, sentAt: new Date(), content: `${unchecked} ${fresh}` },
      { id: 'message-c', conversationId: 'conversation-b', conversation: { ...conversation, zaloAccountId: 'account-b' }, sentAt: new Date(), content: fresh },
    ] as any);
    vi.mocked(prisma.groupLinkDiscovery.findMany).mockImplementation(async (args: any) => args.select?.normalizedUrl ? [
      { zaloAccountId: 'account-a', normalizedUrl: existing, checkStatus: 'valid' },
      { zaloAccountId: 'account-a', normalizedUrl: unchecked, checkStatus: 'unchecked' },
    ] as any : []);
    vi.mocked(prisma.zaloGroupLink.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.zaloGroupLink.create).mockImplementation(async (args: any) => ({ id: 'saved-link', ...args.data }));
    vi.mocked(prisma.zaloGroupLink.count).mockResolvedValue(0);
    vi.mocked(zaloOps.getGroupLinkInfo).mockResolvedValue({ groupId: '123', name: 'Test', memberCount: 10 } as any);
    const routes = new Map<string, any>();
    await groupAudienceRoutes({ addHook: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn(), post: (path: string, handler: any) => routes.set(path, handler) } as any);
    const result = await routes.get('/api/v1/group-link-discoveries/crawl')({ user: { orgId: 'org' }, body: { autoCheck: true } }, {});

    expect(result.crawlStats).toMatchObject({ scannedMessages: 3, found: 6, inserted: 2, existing: 4, checkedZalo: 3 });
    expect(zaloOps.getGroupLinkInfo).toHaveBeenCalledTimes(3);
    expect(zaloOps.getGroupLinkInfo).not.toHaveBeenCalledWith('account-a', existing);
    expect(zaloOps.getGroupLinkInfo).toHaveBeenCalledWith('account-b', fresh);
    expect(prisma.groupLinkDiscovery.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.groupLinkCrawlState.upsert).toHaveBeenCalledOnce();
  });
});
