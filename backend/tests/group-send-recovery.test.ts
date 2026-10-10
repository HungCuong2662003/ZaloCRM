import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, sendMessage } = vi.hoisted(() => ({
  db: {
    groupSendJob: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    groupSendJobLog: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  sendMessage: vi.fn(),
}));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: { sendMessage } }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({ resolveAccount: vi.fn(), checkAccess: vi.fn(), handleError: vi.fn() }));
vi.mock('../src/modules/zalo/group-scan-queue.js', () => ({ enqueueGroupScan: vi.fn() }));

const { runGroupSendJob, resumeGroupSendJobsAfterBoot } = await import('../src/modules/zalo/group-scan-routes.js');
let job: any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  job = { id: 'job', orgId: 'org', zaloAccountId: 'account', state: 'queued', groupIds: ['group'], message: 'Test', repeat: false };
  db.groupSendJob.findUnique.mockImplementation(async () => ({ ...job }));
  db.groupSendJob.update.mockImplementation(async ({ data }) => {
    if (data.state) job.state = data.state;
    return { ...job };
  });
  db.groupSendJob.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.id && job.state === 'running') Object.assign(job, data);
    return { count: 1 };
  });
  db.groupSendJob.findMany.mockResolvedValue([]);
  db.groupSendJobLog.findMany.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
  sendMessage.mockResolvedValue({});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('group send recovery', () => {
  it('retries DB acknowledgement without sending message twice', async () => {
    db.$transaction.mockRejectedValueOnce({ code: 'P2028', message: 'Unable to start a transaction in the given time.' });
    const worker = runGroupSendJob('job');
    await vi.advanceTimersByTimeAsync(30_000);
    await worker;
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(job.state).toBe('completed');
    expect(db.groupSendJobLog.create.mock.calls.every(([args]) => args.data.state === 'sent')).toBe(true);
  });

  it('keeps manual stop while waiting for DB acknowledgement', async () => {
    db.$transaction.mockRejectedValueOnce({ message: 'Unable to start a transaction in the given time.' });
    const worker = runGroupSendJob('job');
    await vi.advanceTimersByTimeAsync(0);
    job.state = 'stopped';
    await vi.advanceTimersByTimeAsync(30_000);
    await worker;
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(job.state).toBe('stopped');
  });

  it('resumes non-repeating job without resending logged groups', async () => {
    db.groupSendJobLog.findMany.mockResolvedValue([{ groupId: 'group' }]);
    await runGroupSendJob('job', { resume: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(job.state).toBe('completed');
  });

  it('recovers transient failures without clearing history or restarting stopped/completed jobs', async () => {
    await resumeGroupSendJobsAfterBoot();
    const recovery = db.groupSendJob.updateMany.mock.calls[0][0];
    expect(recovery.data).toEqual({ state: 'queued', finishedAt: null });
    expect(JSON.stringify(recovery.where)).toContain('Unable to start a transaction');
    expect(JSON.stringify(recovery.where)).toContain('server_restarted');
    const selected = db.groupSendJob.findMany.mock.calls[0][0].where;
    expect(selected.AND[0].OR[0].state.in).toEqual(['queued', 'running']);
    expect(selected.AND[1].OR).toEqual([{ stopAt: null }, { stopAt: { gt: expect.any(Date) } }]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
