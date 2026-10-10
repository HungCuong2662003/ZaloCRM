// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * group-scan-routes.ts — E1 Quét group (🟢 Community).
 * Routes: /api/v1/zalo-accounts/:accountId/group-scans
 *   POST   /                       — tạo scan (selected|all) + enqueue
 *   GET    /:scanId                — trạng thái scan
 *   GET    /:scanId/members        — roster (filter isFriend, phân trang)
 *
 * Auth/error: mirror group-routes.ts (authMiddleware + resolveAccount +
 * checkAccess('read') + handleError).
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { enqueueGroupScan } from './group-scan-queue.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';

const MAX_GROUPS_PER_SCAN = 5000;
const MAX_SEND_GROUPS = 200;
const MIN_SEND_DELAY_MS = 10_000;
const GROUP_SEND_RESUME_BOOT_DELAY_MS = 45_000;
const GROUP_SEND_RETRY_DELAY_MS = 30_000;
const MAX_JOB_IMAGES = 5;
const MAX_JOB_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_GROUP_SEND_BODY_BYTES = 40 * 1024 * 1024;
const GROUP_SEND_UPLOAD_PREFIX = 'group-send';
const GROUP_SEND_SOURCE_MANUAL = 'manual';
const GROUP_SEND_SOURCE_MXHCARE_SERVICES = 'mxhcare_services';
const MXHCARE_API_URL = 'https://mxhcare.com/api/v2';
const MXHCARE_SERVICE_CHUNK_LIMIT = 1800;
const MXHCARE_SERVICE_CHUNK_DELAY_MS = 2000;
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const runningGroupSendJobs = new Set<string>();
const groupSendRetryTimers = new Map<string, NodeJS.Timeout>();
let groupSendResumeScheduled = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

type GroupSendImage = {
  name?: string;
  mimeType: string;
  data?: string;
  path?: string;
  url?: string;
  size?: number;
};

function secondsToDelayMs(value: unknown, fallbackSeconds: number): number {
  const n = Number(value);
  const seconds = Number.isFinite(n) && n > 0 ? Math.round(n) : fallbackSeconds;
  return Math.max(MIN_SEND_DELAY_MS, seconds * 1000);
}

function parseGroupSendDelayRange(input: {
  delaySeconds?: unknown;
  delayMinSeconds?: unknown;
  delayMaxSeconds?: unknown;
}, fallbackMs = 30_000): { delayMs: number; delayMinMs: number; delayMaxMs: number } | null {
  const fallbackSeconds = Math.max(10, Math.round(fallbackMs / 1000));
  const hasRange = input.delayMinSeconds !== undefined || input.delayMaxSeconds !== undefined;
  const minMs = hasRange
    ? secondsToDelayMs(input.delayMinSeconds, fallbackSeconds)
    : secondsToDelayMs(input.delaySeconds, fallbackSeconds);
  const maxMs = hasRange
    ? secondsToDelayMs(input.delayMaxSeconds, Math.round(minMs / 1000))
    : minMs;
  if (maxMs < minMs) return null;
  return { delayMs: minMs, delayMinMs: minMs, delayMaxMs: maxMs };
}

function delayRangeForJob(job: any): { minMs: number; maxMs: number } {
  const minMs = Math.max(MIN_SEND_DELAY_MS, Number(job.delayMinMs ?? job.delayMs ?? 30_000));
  const maxMs = Math.max(minMs, Number(job.delayMaxMs ?? minMs));
  return { minMs, maxMs };
}

function randomDelayForJob(job: any): number {
  const { minMs, maxMs } = delayRangeForJob(job);
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function isGroupSendDisconnectedError(err: unknown): boolean {
  const error = err as { code?: string; message?: unknown } | null;
  const message = String(error?.message ?? err);
  return error?.code === 'NOT_CONNECTED' || message.includes('Zalo account not connected');
}

function isGroupSendDbBusyError(err: unknown): boolean {
  const error = err as { code?: string; message?: unknown } | null;
  return error?.code === 'P2024' || /Unable to start a transaction|Timed out fetching a new connection/i.test(String(error?.message ?? err));
}

async function retryGroupSendDb<T>(operation: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      if (!isGroupSendDbBusyError(err)) throw err;
      logger.warn({ err }, '[group-send] DB busy; retry without resending message in 30s');
      await sleep(GROUP_SEND_RETRY_DELAY_MS);
    }
  }
}

function cancelGroupSendRetry(jobId: string): void {
  const timer = groupSendRetryTimers.get(jobId);
  if (!timer) return;
  clearTimeout(timer);
  groupSendRetryTimers.delete(jobId);
}

function scheduleGroupSendRetry(jobId: string): void {
  if (groupSendRetryTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    groupSendRetryTimers.delete(jobId);
    void prisma.groupSendJob.findUnique({ where: { id: jobId } })
      .then((job) => {
        if (!job || job.state !== 'queued') return;
        if (job.stopAt && new Date() >= job.stopAt) {
          return prisma.groupSendJob.update({
            where: { id: jobId },
            data: { state: 'stopped', finishedAt: new Date() },
          }).then(() => undefined);
        }
        void runGroupSendJob(jobId, { resume: true });
      })
      .catch((err) => {
        logger.warn({ err, jobId }, '[group-send] retry check failed');
        scheduleGroupSendRetry(jobId);
      });
  }, GROUP_SEND_RETRY_DELAY_MS);
  timer.unref();
  groupSendRetryTimers.set(jobId, timer);
}

function normalizeGroupSendImages(input: unknown): GroupSendImage[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => {
      const mimeType = String(item?.mimeType ?? '');
      const data = typeof item?.data === 'string' ? item.data : '';
      const storedPath = typeof item?.path === 'string' ? item.path.replace(/\\/g, '/') : '';
      return {
        name: String(item?.name ?? 'image'),
        mimeType,
        data: data || undefined,
        path: storedPath || undefined,
        url: typeof item?.url === 'string' ? item.url : undefined,
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : undefined,
      };
    })
    .filter((item) => IMAGE_MIME_EXT[item.mimeType] && (item.data || item.path));
}

function publicGroupSendImageUrl(fileKey: string) {
  return `${config.localPublicUrl}/${fileKey.split('/').map(encodeURIComponent).join('/')}`;
}

function safeStoredGroupSendPath(fileKey: string): string | null {
  const normalized = fileKey.replace(/\\/g, '/');
  if (!normalized.startsWith(`${GROUP_SEND_UPLOAD_PREFIX}/`) || normalized.includes('..') || path.isAbsolute(normalized)) {
    return null;
  }
  const root = path.resolve(config.uploadDir);
  const fullPath = path.resolve(config.uploadDir, normalized);
  const rel = path.relative(root, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return fullPath;
}

function serializeGroupSendImages(input: unknown, includeData = false) {
  return normalizeGroupSendImages(input).map((image) => ({
    name: image.name,
    mimeType: image.mimeType,
    path: image.path,
    url: image.url ?? (image.path ? publicGroupSendImageUrl(image.path) : undefined),
    size: image.size,
    hasData: Boolean(image.data),
    ...(includeData && image.data ? { data: image.data } : {}),
  }));
}

function validateGroupSendImages(input: unknown): GroupSendImage[] {
  const images = normalizeGroupSendImages(input);
  if (images.length > MAX_JOB_IMAGES) {
    throw new Error(`too many images (max ${MAX_JOB_IMAGES})`);
  }
  for (const image of images) {
    if (image.path && !safeStoredGroupSendPath(image.path)) {
      throw new Error('invalid stored image path');
    }
    const bytes = image.data ? Buffer.from(image.data, 'base64').length : Number(image.size ?? 0);
    if (bytes > MAX_JOB_IMAGE_BYTES) {
      throw new Error(`image too large (max ${MAX_JOB_IMAGE_BYTES / 1024 / 1024}MB)`);
    }
  }
  return images;
}

async function withGroupSendImagePaths<T>(images: GroupSendImage[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  if (!images.length) return fn([]);
  const storedPaths: string[] = [];
  const inlineImages: GroupSendImage[] = [];
  for (const image of images) {
    if (image.path) {
      const storedPath = safeStoredGroupSendPath(image.path);
      if (!storedPath) throw new Error('invalid stored image path');
      storedPaths.push(storedPath);
    } else if (image.data) {
      inlineImages.push(image);
    }
  }
  if (!inlineImages.length) return fn(storedPaths);
  const dir = path.join(tmpdir(), 'zalocrm-group-send', randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const paths = await Promise.all(inlineImages.map(async (image, index) => {
      const filePath = path.join(dir, `${index}${IMAGE_MIME_EXT[image.mimeType]}`);
      await writeFile(filePath, Buffer.from(image.data ?? '', 'base64'));
      return filePath;
    }));
    return await fn([...storedPaths, ...paths]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

type MxhcareService = Record<string, any>;

function envText(name: string, fallback = ''): string {
  return (process.env[name] ?? '').trim() || fallback;
}

function numberFrom(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactText(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trim()}...` : text;
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatMxhcareServicePrice(service: MxhcareService): string {
  const rate = numberFrom(service.rate);
  const ratePer = numberFrom(process.env.MXHCARE_RATE_PER, 1000);
  const usdToVnd = numberFrom(process.env.USD_TO_VND, 27000);
  const markup = 1 + numberFrom(process.env.SELLING_MARKUP_PERCENT, 0) / 100;
  return `${formatVnd(rate * usdToVnd * markup)} VND / ${formatVnd(ratePer)}`;
}

async function fetchMxhcareServices(): Promise<MxhcareService[]> {
  const key = envText('MXHCARE_API_KEY');
  if (!key) throw new Error('missing_mxhcare_api_key');
  const response = await fetch(envText('MXHCARE_API_URL', MXHCARE_API_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key, action: 'services' }),
  });
  if (!response.ok) throw new Error(`mxhcare_api_http_${response.status}`);
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new Error('mxhcare_api_invalid_response');
  return data.filter((item): item is MxhcareService => item && typeof item === 'object');
}

function groupedMxhcareServices(services: MxhcareService[]): Array<[string, MxhcareService[]]> {
  const groups = new Map<string, MxhcareService[]>();
  for (const service of services) {
    const category = compactText(service.category || 'Khac', 240) || 'Khac';
    groups.set(category, [...(groups.get(category) ?? []), service]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'vi'));
}

function formatMxhcareServiceLine(service: MxhcareService, index: number): string {
  const name = compactText(service.name || 'Khong ten', 120);
  const refill = service.refill ? 'Co refill' : 'Khong refill';
  const cancel = service.cancel ? 'Co huy' : 'Khong huy';
  return [
    `${index}. #${service.service ?? ''} ${name}`,
    `GIA: ${formatMxhcareServicePrice(service)} | Min/Max: ${service.min ?? ''} - ${service.max ?? ''}`,
    `Bao hanh: ${refill} | Huy: ${cancel}`,
  ].join('\n');
}

function mxhcareServiceContactText(): string {
  const support = envText('SUPPORT_USERNAME', 'mxhcare').replace(/^@/, '');
  return [
    'Lien he dat hang:',
    `Telegram: @${support}`,
    `Dien thoai/Zalo: ${envText('COMPANY_PHONE', '0832657428')}`,
    `Website: ${envText('COMPANY_WEBSITE', 'mxhcare.com')}`,
    `Group Zalo: ${envText('COMPANY_ZALO_GROUP', 'https://zalo.me/g/fyiueu911')}`,
  ].join('\n');
}

function buildMxhcareServiceChunks(category: string, services: MxhcareService[]): string[] {
  const sorted = [...services].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  const header = [
    'BANG DICH VU MXHCARE',
    `Phan loai: ${category}`,
    `Tong dich vu: ${sorted.length}`,
    '',
    'Gui bot Telegram de dat dich vu.',
  ].join('\n');
  const chunks: string[] = [];
  let current = header;
  let part = 1;
  sorted.forEach((service, index) => {
    const block = `\n\n${formatMxhcareServiceLine(service, index + 1)}`;
    if (current.length + block.length > MXHCARE_SERVICE_CHUNK_LIMIT) {
      chunks.push(current);
      part += 1;
      current = `${header}\nPhan: ${part}`;
    }
    current += block;
  });
  if (current.trim()) chunks.push(current);
  const footer = `\n\n${mxhcareServiceContactText()}`;
  if (chunks.length && chunks[chunks.length - 1].length + footer.length <= MXHCARE_SERVICE_CHUNK_LIMIT) {
    chunks[chunks.length - 1] += footer;
  } else {
    chunks.push(mxhcareServiceContactText());
  }
  return chunks;
}

async function buildNextMxhcareServicePost(job: any) {
  const groups = groupedMxhcareServices(await fetchMxhcareServices());
  if (!groups.length) throw new Error('mxhcare_services_empty');
  const currentIndex = Math.max(0, Number(job.serviceNextIndex ?? 0));
  const [category, services] = groups[currentIndex % groups.length];
  return {
    category,
    chunks: buildMxhcareServiceChunks(category, services),
    nextIndex: (currentIndex + 1) % groups.length,
    totalCategories: groups.length,
  };
}

async function loggedGroupIds(jobId: string) {
  const rows = await prisma.groupSendJobLog.findMany({
    where: { jobId, state: 'sent' },
    select: { groupId: true },
  });
  return new Set(rows.map((row) => row.groupId));
}

export async function runGroupSendJob(jobId: string, options: { resume?: boolean } = {}) {
  if (runningGroupSendJobs.has(jobId)) return;
  runningGroupSendJobs.add(jobId);
  try {
    const current = await retryGroupSendDb(() => prisma.groupSendJob.findUnique({ where: { id: jobId } }));
    if (!current || !['queued', 'running'].includes(current.state)) return;
    cancelGroupSendRetry(jobId);
    const started = await retryGroupSendDb(() => prisma.groupSendJob.update({
      where: { id: jobId, state: { in: ['running', 'queued'] } },
      data: { state: 'running', startedAt: new Date(), finishedAt: null, lastError: null },
    }));
    const skipLogged = options.resume && !started.repeat ? await retryGroupSendDb(() => loggedGroupIds(jobId)) : new Set<string>();
    logger.info(`[group-send] started job=${started.id} account=${started.zaloAccountId} groups=${(started.groupIds as unknown[]).length}`);
    let waitingForConnection = false;
    do {
      const snapshot = await retryGroupSendDb(() => prisma.groupSendJob.update({
        where: { id: jobId },
        data: { cycles: { increment: 1 } },
      }));
      const groupIds = Array.isArray(snapshot.groupIds) ? (snapshot.groupIds as unknown[]).map(String) : [];
      const servicePost = snapshot.sourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES
        ? await buildNextMxhcareServicePost(snapshot)
        : null;
      let servicePostAttempted = false;
      for (const groupId of groupIds) {
        if (skipLogged.has(groupId)) continue;
        const current = await retryGroupSendDb(() => prisma.groupSendJob.findUnique({ where: { id: jobId } }));
        if (!current || current.state !== 'running') break;
        if (current.stopAt && new Date() >= current.stopAt) {
          await retryGroupSendDb(() => prisma.groupSendJob.update({
            where: { id: jobId },
            data: { state: 'stopped', finishedAt: new Date() },
          }));
          break;
        }
        try {
          if (servicePost) {
            servicePostAttempted = true;
            for (let i = 0; i < servicePost.chunks.length; i += 1) {
              await zaloOps.sendMessage(current.zaloAccountId, groupId, 1, { msg: servicePost.chunks[i] }, null);
              if (i < servicePost.chunks.length - 1) await sleep(MXHCARE_SERVICE_CHUNK_DELAY_MS);
            }
          } else {
            const images = normalizeGroupSendImages(current.imageAttachments);
            await withGroupSendImagePaths(images, (paths) => (
              paths.length
                ? zaloOps.sendImage(current.zaloAccountId, groupId, 1, paths, null, current.message)
                : zaloOps.sendMessage(current.zaloAccountId, groupId, 1, { msg: current.message }, null)
            ));
          }
          await retryGroupSendDb(() => prisma.$transaction([
            prisma.groupSendJob.update({
              where: { id: jobId },
              data: { sent: { increment: 1 } },
            }),
            prisma.groupSendJobLog.create({
              data: { jobId, orgId: current.orgId, groupId, state: 'sent', category: servicePost?.category },
            }),
          ]));
          logger.info(`[group-send] sent job=${jobId} group=${groupId}`);
        } catch (err: any) {
          const error = String(err?.message ?? err);
          if (isGroupSendDisconnectedError(err)) {
            waitingForConnection = true;
            await retryGroupSendDb(() => prisma.groupSendJob.updateMany({
              where: { id: jobId, state: { in: ['running', 'queued'] } },
              data: { state: 'queued', lastError: error, finishedAt: null },
            }));
            logger.warn(`[group-send] paused job=${jobId}: ${error}; retry in ${GROUP_SEND_RETRY_DELAY_MS}ms`);
            break;
          }
          await retryGroupSendDb(() => prisma.$transaction([
            prisma.groupSendJob.update({
              where: { id: jobId },
              data: { failed: { increment: 1 }, lastError: error },
            }),
            prisma.groupSendJobLog.create({
              data: { jobId, orgId: current.orgId, groupId, state: 'failed', category: servicePost?.category, error },
            }),
          ]));
          logger.warn(`[group-send] failed job=${jobId} group=${groupId}: ${error}`);
        }
        if (groupIds.indexOf(groupId) < groupIds.length - 1) await sleep(randomDelayForJob(current));
      }
      if (waitingForConnection) {
        scheduleGroupSendRetry(jobId);
        return;
      }
      if (servicePost && servicePostAttempted) {
        await retryGroupSendDb(() => prisma.groupSendJob.update({
          where: { id: jobId },
          data: {
            serviceNextIndex: servicePost.nextIndex,
            serviceLastCategory: servicePost.category,
            serviceLastPostedAt: new Date(),
          },
        }));
      }
      const afterCycle = await retryGroupSendDb(() => prisma.groupSendJob.findUnique({ where: { id: jobId } }));
      if (!afterCycle || afterCycle.state !== 'running' || !afterCycle.repeat) break;
      if (afterCycle.stopAt && new Date(Date.now() + afterCycle.repeatPauseMs) >= afterCycle.stopAt) {
        await retryGroupSendDb(() => prisma.groupSendJob.update({
          where: { id: jobId },
          data: { state: 'stopped', finishedAt: new Date() },
        }));
        break;
      }
      await sleep(afterCycle.repeatPauseMs);
    } while (true);
    const finalJob = await retryGroupSendDb(() => prisma.groupSendJob.findUnique({ where: { id: jobId } }));
    if (finalJob?.state === 'running') {
      await retryGroupSendDb(() => prisma.groupSendJob.updateMany({
        where: { id: jobId, state: 'running' },
        data: { state: 'completed', finishedAt: new Date() },
      }));
    }
  } catch (err: any) {
    await prisma.groupSendJob.updateMany({
      where: { id: jobId, state: { in: ['running', 'queued'] } },
      data: { state: 'failed', lastError: String(err?.message ?? err), finishedAt: new Date() },
    }).catch(() => {});
  } finally {
    runningGroupSendJobs.delete(jobId);
    const done = await prisma.groupSendJob.findUnique({ where: { id: jobId } }).catch(() => null);
    logger.info(`[group-send] finished job=${jobId} state=${done?.state} sent=${done?.sent} failed=${done?.failed}`);
  }
}

export async function resumeGroupSendJobsAfterBoot() {
  const now = new Date();
  await prisma.groupSendJob.updateMany({
    where: {
      AND: [
        { OR: [
          { state: 'stopped', lastError: 'server_restarted' },
          { state: 'failed', OR: [
            { lastError: { contains: 'Zalo account not connected' } },
            { lastError: { contains: 'Unable to start a transaction' } },
            { lastError: { contains: 'Timed out fetching a new connection' } },
          ] },
        ] },
        { OR: [{ stopAt: null }, { stopAt: { gt: now } }] },
      ],
    },
    data: { state: 'queued', finishedAt: null },
  });
  await prisma.groupSendJob.updateMany({
    where: {
      OR: [
        { state: { in: ['queued', 'running'] } },
        { state: 'stopped', lastError: 'server_restarted' },
      ],
      stopAt: { lte: now },
    },
    data: { state: 'stopped', finishedAt: now, lastError: 'stop_time_passed_while_server_offline' },
  });
  const jobs = await prisma.groupSendJob.findMany({
    where: {
      id: { notIn: [...runningGroupSendJobs] },
      AND: [
        {
          OR: [
            { state: { in: ['queued', 'running'] } },
            { state: 'stopped', lastError: 'server_restarted' },
          ],
        },
        { OR: [{ stopAt: null }, { stopAt: { gt: now } }] },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  if (!jobs.length) return;
  logger.info(`[group-send] resume ${jobs.length} running/queued job(s)`);
  for (const job of jobs) void runGroupSendJob(job.id, { resume: true });
}

function scheduleGroupSendResumeAfterBoot() {
  if (groupSendResumeScheduled) return;
  groupSendResumeScheduled = true;
  const timer = setTimeout(() => {
    const resume = () => void resumeGroupSendJobsAfterBoot().catch((err) => logger.warn({ err }, '[group-send] resume check failed'));
    resume();
    const watchdog = setInterval(resume, GROUP_SEND_RETRY_DELAY_MS);
    watchdog.unref();
  }, GROUP_SEND_RESUME_BOOT_DELAY_MS);
  timer.unref();
}

async function serializeGroupSendJob(job: any, options: { includeImageData?: boolean } = {}) {
  const { imageAttachments, ...rest } = job ?? {};
  return {
    ...rest,
    imageAttachments: serializeGroupSendImages(imageAttachments, Boolean(options.includeImageData)),
    accountId: rest.zaloAccountId,
    accountName: rest.zaloAccount?.displayName ?? null,
    logs: (rest.logs ?? []).map((log: any) => ({
      ...log,
      at: log.createdAt,
    })),
  };
}

export async function groupScanRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  if (process.env.NODE_ENV !== 'test') scheduleGroupSendResumeAfterBoot();

  const BASE = '/api/v1/zalo-accounts/:accountId/group-scans';

  // ── Create scan ───────────────────────────────────────────────────────────
  app.post<{ Params: { accountId: string }; Body: { groupIds?: string[]; all?: boolean } }>(
    BASE,
    async (request, reply) => {
      const { accountId } = request.params;
      const { groupIds, all } = request.body ?? {};
      if (!all && (!Array.isArray(groupIds) || groupIds.length === 0)) {
        return reply.status(400).send({ error: 'groupIds array is required when all is not set' });
      }
      // Chặn payload khổng lồ (review #4): IN (...) lớn + job/row flood.
      if (Array.isArray(groupIds) && groupIds.length > MAX_GROUPS_PER_SCAN) {
        return reply
          .status(400)
          .send({ error: `too many groupIds (max ${MAX_GROUPS_PER_SCAN})` });
      }
      try {
        const account = await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        // Dedup in-flight (review #4): 1 nick chỉ 1 scan đang chạy — tránh 2 scan
        // cùng nick race upsert + flood job. Trả scan đang chạy thay vì tạo mới.
        const inFlight = await prisma.groupScan.findFirst({
          where: { zaloAccountId: accountId, orgId: account.orgId, state: { in: ['queued', 'running'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (inFlight) {
          return reply.status(409).send({ error: 'a scan is already running for this account', scan: inFlight });
        }

        let ids: string[];
        let scope: string;
        if (all) {
          // Snapshot toàn bộ group nick đang tham gia → groupIds.
          const res = (await zaloOps.getAllGroups(accountId)) as {
            gridVerMap?: Record<string, string>;
          };
          ids = Object.keys(res?.gridVerMap ?? {});
          scope = 'all';
        } else {
          ids = [...new Set(groupIds!.map(String))];
          scope = 'selected';
        }

        const scan = await prisma.groupScan.create({
          data: {
            orgId: account.orgId,
            zaloAccountId: accountId,
            scope,
            groupIds: ids,
            state: 'queued',
            totalGroups: ids.length,
          },
        });

        await enqueueGroupScan(scan.id);
        return reply.status(201).send({ scan });
      } catch (err) {
        return handleError(reply, err, 'createGroupScan');
      }
    },
  );

  // ── Scan status ───────────────────────────────────────────────────────────
  app.get<{ Params: { accountId: string; scanId: string } }>(
    `${BASE}/:scanId`,
    async (request, reply) => {
      const { accountId, scanId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        const scan = await prisma.groupScan.findFirst({
          where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        });
        if (!scan) return reply.status(404).send({ error: 'Scan not found' });
        return { scan };
      } catch (err) {
        return handleError(reply, err, 'getGroupScan');
      }
    },
  );

  // ── Roster (members of scan's groups) ─────────────────────────────────────
  app.get<{
    Params: { accountId: string; scanId: string };
    Querystring: { isFriend?: string; page?: string; limit?: string };
  }>(`${BASE}/:scanId/members`, async (request, reply) => {
    const { accountId, scanId } = request.params;
    const { isFriend, page, limit } = request.query;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;

      const scan = await prisma.groupScan.findFirst({
        where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        select: { groupIds: true },
      });
      if (!scan) return reply.status(404).send({ error: 'Scan not found' });

      const groupIds: string[] = Array.isArray(scan.groupIds)
        ? (scan.groupIds as unknown[]).map(String)
        : [];

      const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));

      const where: {
        zaloAccountId: string;
        groupId: { in: string[] };
        isFriend?: boolean;
      } = { zaloAccountId: accountId, groupId: { in: groupIds } };
      if (isFriend === 'true') where.isFriend = true;
      else if (isFriend === 'false') where.isFriend = false;

      const [members, total] = await Promise.all([
        prisma.groupMember.findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.groupMember.count({ where }),
      ]);

      return { members, total, page: pageNum, limit: limitNum };
    } catch (err) {
      return handleError(reply, err, 'getGroupScanMembers');
    }
  });

  // ── Export roster as CSV (Excel opens it) ────────────────────────────────
  app.get<{
    Params: { accountId: string; scanId: string };
    Querystring: { isFriend?: string };
  }>(`${BASE}/:scanId/export.csv`, async (request, reply) => {
    const { accountId, scanId } = request.params;
    const { isFriend } = request.query;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;

      const scan = await prisma.groupScan.findFirst({
        where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        select: { groupIds: true },
      });
      if (!scan) return reply.status(404).send({ error: 'Scan not found' });

      const groupIds = Array.isArray(scan.groupIds) ? (scan.groupIds as unknown[]).map(String) : [];
      const where: any = { zaloAccountId: accountId, groupId: { in: groupIds } };
      if (isFriend === 'true') where.isFriend = true;
      else if (isFriend === 'false') where.isFriend = false;

      const members = await prisma.groupMember.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        take: 20_000,
      });

      const header = ['Tên hiển thị', 'Tên Zalo', 'UID', 'Group ID', 'Là bạn', 'Admin', 'Quét lúc'];
      const lines = [
        header.map(csvCell).join(','),
        ...members.map((m) => [
          m.displayName,
          m.zaloName,
          m.memberUid,
          m.groupId,
          m.isFriend ? 'Có' : 'Không',
          m.isAdmin ? 'Có' : 'Không',
          m.harvestedAt.toISOString(),
        ].map(csvCell).join(',')),
      ];
      const csv = `\uFEFF${lines.join('\r\n')}`;
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="group-scan-${scanId}.csv"`)
        .send(csv);
    } catch (err) {
      return handleError(reply, err, 'exportGroupScanMembers');
    }
  });

  // ── Save scanned members as CRM contacts ─────────────────────────────────
  app.post<{
    Params: { accountId: string; scanId: string };
    Body: { isFriend?: boolean };
  }>(`${BASE}/:scanId/save-contacts`, async (request, reply) => {
    const { accountId, scanId } = request.params;
    const { isFriend } = request.body ?? {};
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;

      const scan = await prisma.groupScan.findFirst({
        where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        select: { groupIds: true },
      });
      if (!scan) return reply.status(404).send({ error: 'Scan not found' });

      const groupIds = Array.isArray(scan.groupIds) ? (scan.groupIds as unknown[]).map(String) : [];
      const where: any = { zaloAccountId: accountId, groupId: { in: groupIds } };
      if (typeof isFriend === 'boolean') where.isFriend = isFriend;

      const members = await prisma.groupMember.findMany({ where, take: 20_000 });
      let created = 0;
      let updated = 0;
      for (const m of members) {
        const existing = await prisma.contact.findFirst({
          where: { orgId: request.user!.orgId, zaloUid: m.memberUid },
          select: { id: true },
        });
        const data = {
          orgId: request.user!.orgId,
          zaloUid: m.memberUid,
          zaloGlobalId: m.globalId ?? undefined,
          fullName: m.displayName ?? m.zaloName ?? null,
          avatarUrl: m.avatarUrl ?? null,
          source: 'zalo_group_scan',
          sourceDate: new Date(),
          hasZalo: true,
          metadata: { sourceGroupId: m.groupId, sourceScanId: scanId, isFriend: m.isFriend },
        };
        if (existing) {
          await prisma.contact.update({ where: { id: existing.id }, data });
          updated += 1;
        } else {
          await prisma.contact.create({ data });
          created += 1;
        }
      }
      return { created, updated, total: members.length };
    } catch (err) {
      return handleError(reply, err, 'saveGroupScanContacts');
    }
  });

  // ── Send one message to selected groups in background ────────────────────
  app.post<{ Params: { accountId: string } }>(
    `/api/v1/zalo-accounts/:accountId/group-send-images`,
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        const account = await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;

        const images: GroupSendImage[] = [];
        for await (const part of request.parts()) {
          if (part.type !== 'file') continue;
          const ext = IMAGE_MIME_EXT[part.mimetype];
          if (!ext) return reply.status(415).send({ error: `unsupported image type: ${part.mimetype}` });
          if (images.length >= MAX_JOB_IMAGES) {
            return reply.status(400).send({ error: `too many images (max ${MAX_JOB_IMAGES})` });
          }

          const buffer = await part.toBuffer();
          if (buffer.length > MAX_JOB_IMAGE_BYTES) {
            return reply.status(413).send({ error: `image too large (max ${MAX_JOB_IMAGE_BYTES / 1024 / 1024}MB)` });
          }

          const fileKey = `${GROUP_SEND_UPLOAD_PREFIX}/${account.orgId}/${accountId}/${randomUUID()}${ext}`;
          const filePath = path.join(config.uploadDir, ...fileKey.split('/'));
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, buffer);
          images.push({
            name: part.filename || `image${ext}`,
            mimeType: part.mimetype,
            path: fileKey,
            url: publicGroupSendImageUrl(fileKey),
            size: buffer.length,
          });
        }

        if (!images.length) return reply.status(400).send({ error: 'images required' });
        return { images };
      } catch (err) {
        return handleError(reply, err, 'uploadGroupSendImages');
      }
    },
  );

  app.post<{
    Params: { accountId: string };
    Body: {
      groupIds?: string[];
      message?: string;
      delaySeconds?: number;
      delayMinSeconds?: number;
      delayMaxSeconds?: number;
      stopAt?: string;
      repeat?: boolean;
      repeatEveryMinutes?: number;
      autoStart?: boolean;
      sourceType?: string;
      imageAttachments?: unknown;
    };
  }>(`/api/v1/zalo-accounts/:accountId/group-send-jobs`, { bodyLimit: MAX_GROUP_SEND_BODY_BYTES }, async (request, reply) => {
    const { accountId } = request.params;
    const { groupIds, message, delaySeconds, delayMinSeconds, delayMaxSeconds, stopAt, repeat, repeatEveryMinutes, autoStart, sourceType: rawSourceType, imageAttachments } = request.body ?? {};
    const sourceType = rawSourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES ? GROUP_SEND_SOURCE_MXHCARE_SERVICES : GROUP_SEND_SOURCE_MANUAL;
    if (!Array.isArray(groupIds) || !groupIds.length) return reply.status(400).send({ error: 'groupIds required' });
    if (groupIds.length > MAX_SEND_GROUPS) return reply.status(400).send({ error: `too many groups (max ${MAX_SEND_GROUPS})` });
    if (repeat && !stopAt && sourceType !== GROUP_SEND_SOURCE_MXHCARE_SERVICES) return reply.status(400).send({ error: 'stopAt required when repeat is enabled' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;

      const images = validateGroupSendImages(imageAttachments);
      if (sourceType !== GROUP_SEND_SOURCE_MXHCARE_SERVICES && !message?.trim() && !images.length) return reply.status(400).send({ error: 'message or image required' });
      const delay = parseGroupSendDelayRange({ delaySeconds, delayMinSeconds, delayMaxSeconds });
      if (!delay) return reply.status(400).send({ error: 'delayMaxSeconds must be greater than or equal to delayMinSeconds' });
      const repeatPauseMs = Math.max(60_000, Math.round(Number(repeatEveryMinutes || 60) * 60_000));
      const job = await prisma.groupSendJob.create({
        data: {
          orgId: request.user!.orgId,
          zaloAccountId: accountId,
          groupIds: [...new Set(groupIds.map(String))],
          sourceType,
          message: sourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES ? '' : message?.trim() ?? '',
          imageAttachments: sourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES ? [] : images,
          ...delay,
          stopAt: stopAt ? new Date(stopAt) : undefined,
          repeat: sourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES ? true : Boolean(repeat),
          repeatPauseMs,
          state: autoStart ? 'queued' : 'draft',
          createdById: request.user!.id,
        },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' } } },
      });
      if (autoStart) void runGroupSendJob(job.id);
      return reply.status(201).send({ job: await serializeGroupSendJob(job) });
    } catch (err) {
      return handleError(reply, err, 'createGroupSendJob');
    }
  });

  app.get<{ Params: { accountId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs',
    async (request, reply) => {
      const { accountId } = request.params;
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const jobs = await prisma.groupSendJob.findMany({
        where: { orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 500 } },
      });
      return { jobs: await Promise.all(jobs.map((job) => serializeGroupSendJob(job))) };
    },
  );

  app.get<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs/:jobId',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupSendJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 1000 } },
      });
      if (!job) {
        return reply.status(404).send({ error: 'job_not_found' });
      }
      return { job: await serializeGroupSendJob(job) };
    },
  );

  app.post<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs/:jobId/stop',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupSendJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
      });
      if (!job) {
        return reply.status(404).send({ error: 'job_not_found' });
      }
      if (job.state === 'queued' || job.state === 'running') {
        cancelGroupSendRetry(jobId);
        await prisma.groupSendJob.update({
          where: { id: jobId },
          data: { state: 'stopped', finishedAt: new Date() },
        });
      }
      const updated = await prisma.groupSendJob.findUnique({
        where: { id: jobId },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 1000 } },
      });
      return { job: await serializeGroupSendJob(updated) };
    },
  );

  app.post<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs/:jobId/start',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupSendJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { in: ['draft', 'stopped', 'completed', 'failed'] } },
      });
      if (!job) return reply.status(404).send({ error: 'job_not_found_or_not_startable' });
      await prisma.$transaction([
        prisma.groupSendJob.update({
          where: { id: jobId },
          data: { state: 'queued', sent: 0, failed: 0, cycles: 0, startedAt: null, finishedAt: null, lastError: null },
        }),
        prisma.groupSendJobLog.deleteMany({ where: { jobId } }),
      ]);
      cancelGroupSendRetry(jobId);
      void runGroupSendJob(jobId);
      const updated = await prisma.groupSendJob.findUnique({
        where: { id: jobId },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' } } },
      });
      return { job: await serializeGroupSendJob(updated) };
    },
  );

  app.patch<{
    Params: { accountId: string; jobId: string };
    Body: { groupIds?: string[]; message?: string; delaySeconds?: number; delayMinSeconds?: number; delayMaxSeconds?: number; stopAt?: string | null; repeat?: boolean; repeatEveryMinutes?: number; imageAttachments?: unknown };
  }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs/:jobId',
    { bodyLimit: MAX_GROUP_SEND_BODY_BYTES },
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      const { groupIds, message, delaySeconds, delayMinSeconds, delayMaxSeconds, stopAt, repeat, repeatEveryMinutes, imageAttachments } = request.body ?? {};
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupSendJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { in: ['draft', 'stopped', 'completed', 'failed'] } },
      });
      if (!job) return reply.status(409).send({ error: 'job_not_editable' });
      if (groupIds && (!Array.isArray(groupIds) || !groupIds.length || groupIds.length > MAX_SEND_GROUPS)) {
        return reply.status(400).send({ error: `groupIds invalid (1-${MAX_SEND_GROUPS})` });
      }
      const isServiceJob = job.sourceType === GROUP_SEND_SOURCE_MXHCARE_SERVICES;
      const images = imageAttachments !== undefined ? validateGroupSendImages(imageAttachments) : undefined;
      if (!isServiceJob && message !== undefined && !message.trim() && !(images?.length ?? normalizeGroupSendImages(job.imageAttachments).length)) {
        return reply.status(400).send({ error: 'message or image required' });
      }
      const delayTouched = delaySeconds !== undefined || delayMinSeconds !== undefined || delayMaxSeconds !== undefined;
      const delay = delayTouched
        ? parseGroupSendDelayRange({ delaySeconds, delayMinSeconds, delayMaxSeconds }, job.delayMs)
        : null;
      if (delayTouched && !delay) {
        return reply.status(400).send({ error: 'delayMaxSeconds must be greater than or equal to delayMinSeconds' });
      }
      const updated = await prisma.groupSendJob.update({
        where: { id: jobId },
        data: {
          ...(groupIds ? { groupIds: [...new Set(groupIds.map(String))] } : {}),
          ...(message !== undefined ? { message: isServiceJob ? '' : message.trim() } : {}),
          ...(images !== undefined && !isServiceJob ? { imageAttachments: images } : {}),
          ...(delay ? delay : {}),
          ...(stopAt !== undefined ? { stopAt: stopAt ? new Date(stopAt) : null } : {}),
          ...(repeat !== undefined ? { repeat: isServiceJob ? true : Boolean(repeat) } : {}),
          ...(repeatEveryMinutes !== undefined ? { repeatPauseMs: Math.max(60_000, Math.round(Number(repeatEveryMinutes) * 60_000)) } : {}),
        },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' } } },
      });
      return { job: await serializeGroupSendJob(updated) };
    },
  );

  app.delete<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-send-jobs/:jobId',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupSendJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
      });
      if (!job) return reply.status(404).send({ error: 'job_not_found' });
      await prisma.groupSendJob.update({
        where: { id: jobId },
        data: { state: 'deleted', finishedAt: new Date() },
      });
      cancelGroupSendRetry(jobId);
      return { ok: true };
    },
  );
}
