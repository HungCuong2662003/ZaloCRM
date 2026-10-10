// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { resolveAccount, checkAccess, getAccessibleZaloAccountIds, handleError } from './zalo-route-helpers.js';
import { logger } from '../../shared/utils/logger.js';

const MAX_IMPORT_LINKS = 1000;
const MAX_DISCOVERY_MESSAGES = 50_000;
const DEFAULT_DISCOVERY_MESSAGES = 5_000;
const MAX_GROUP_JOIN_LINKS = 1000;
const MAX_GROUP_JOIN_PER_DAY = 500;
const MIN_GROUP_JOIN_DELAY_MS = 10_000;
const GROUP_LINK_CHECK_CACHE_MS = 60_000;
const GROUP_JOIN_SCHEDULER_MS = 60_000;

type DiscoveredCandidate = {
  platform: 'zalo' | 'telegram' | 'facebook' | 'web';
  linkKind: 'group' | 'unknown';
  rawUrl: string;
  normalizedUrl: string;
  externalKey: string | null;
};

function normalizeGroupLink(raw: string): { ok: boolean; raw: string; normalizedLink: string; linkId: string; error?: string } {
  const text = raw.trim();
  if (!text) return { ok: false, raw, normalizedLink: '', linkId: '', error: 'empty' };
  const match = text.match(/(?:zalo\.me\/g\/|^)([A-Za-z0-9_-]{5,})(?:[/?#].*)?$/i);
  if (!match) return { ok: false, raw, normalizedLink: text, linkId: '', error: 'invalid_link' };
  const linkId = match[1];
  return { ok: true, raw: text, normalizedLink: `https://zalo.me/g/${linkId}`, linkId };
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function nextJoinRunAt() {
  const d = todayStart();
  d.setDate(d.getDate() + 1);
  d.setMinutes(5);
  return d;
}

function randomJoinDelay(job: any) {
  const min = Math.max(MIN_GROUP_JOIN_DELAY_MS, Number(job.delayMinMs ?? 30_000));
  const max = Math.max(min, Number(job.delayMaxMs ?? min));
  return max === min ? min : min + Math.floor(Math.random() * (max - min + 1));
}

export function parseJoinDelayRange(input: { delayMinSeconds?: unknown; delayMaxSeconds?: unknown }) {
  const minSeconds = input.delayMinSeconds === undefined ? 30 : Number(input.delayMinSeconds);
  const maxSeconds = input.delayMaxSeconds === undefined ? minSeconds : Number(input.delayMaxSeconds);
  if (!Number.isFinite(minSeconds) || !Number.isFinite(maxSeconds) || minSeconds < 10 || maxSeconds < minSeconds) return null;
  return { delayMinMs: Math.round(minSeconds * 1000), delayMaxMs: Math.round(maxSeconds * 1000) };
}

function parseStopAt(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanUrl(raw: string) {
  return raw.trim().replace(/^[("'[\s]+|[)"'\],.;:\s]+$/g, '');
}

function withScheme(raw: string) {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function extractLinkCandidates(text: string): string[] {
  const haystack = text.replace(/\\(?:\/|u002f)/gi, '/');
  const matches = haystack.match(/\b(?:https?:\/\/)?(?:www\.)?(?:zalo\.me\/g\/[A-Za-z0-9_-]{5,}|t(?:elegram)?\.me\/[A-Za-z0-9_+/-]+|facebook\.com\/groups\/[A-Za-z0-9_.-]+|m\.facebook\.com\/groups\/[A-Za-z0-9_.-]+|fb\.com\/groups\/[A-Za-z0-9_.-]+|[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s<>"'`)\]]*)?)/gi) ?? [];
  return [...new Set(matches.map(cleanUrl).filter(Boolean))];
}

export function classifyLink(raw: string): DiscoveredCandidate | null {
  const text = cleanUrl(raw);
  const zalo = text.match(/(?:https?:\/\/)?(?:www\.)?zalo\.me\/g\/([A-Za-z0-9_-]{5,})/i);
  if (zalo) {
    return {
      platform: 'zalo',
      linkKind: 'group',
      rawUrl: text,
      normalizedUrl: `https://zalo.me/g/${zalo[1]}`,
      externalKey: zalo[1],
    };
  }

  try {
    const url = new URL(withScheme(text));
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/g, '');
    if (host === 't.me' || host === 'telegram.me') {
      return { platform: 'telegram', linkKind: 'group', rawUrl: text, normalizedUrl: `https://${host}${path}`, externalKey: path.split('/').filter(Boolean).join('/') || null };
    }
    if ((host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.com') && path.toLowerCase().startsWith('/groups/')) {
      return { platform: 'facebook', linkKind: 'group', rawUrl: text, normalizedUrl: `https://facebook.com${path.replace(/^\/groups\//i, '/groups/')}`, externalKey: path.split('/')[2] || null };
    }
    return { platform: 'web', linkKind: 'unknown', rawUrl: text, normalizedUrl: url.toString(), externalKey: null };
  } catch {
    return null;
  }
}

function contentSnippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 280);
}

function isRateLimitedCheck(error: string | null | undefined) {
  return /quá nhanh|vượt quá số request|rate/i.test(String(error ?? ''));
}

function isRateLimitedJoin(error: unknown) {
  const value = error as any;
  return value?.code === 'RATE_LIMITED' ||
    value?.statusCode === 429 ||
    isRateLimitedCheck(value?.message ?? error);
}

function isJoinApprovalPending(error: unknown) {
  return /zalo:240\b|waiting for approve|pending approval|đã được gửi.*duyệt|chờ.*duyệt/i.test(String(error ?? ''));
}

function splitLinks(input: { text?: string; links?: string[] }): string[] {
  const fromText = String(input.text ?? '').split(/[\s,;]+/);
  return [...(input.links ?? []), ...fromText].map((v) => String(v).trim()).filter(Boolean).slice(0, MAX_IMPORT_LINKS);
}

function queryBool(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).toLowerCase();
  if (text === 'unknown' || text === 'null') return null;
  return text === 'true' || text === '1' || text === 'yes';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function firstBool(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function firstFlag(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    const n = Number(value);
    if (Number.isFinite(n) && (n === 0 || n === 1)) return n === 1;
  }
  return null;
}

function groupInfoFields(info: any, fallback: any = {}) {
  const body = info?.groupInfo ?? info?.data ?? info?.result ?? info ?? {};
  const map = body?.gridInfoMap ?? info?.gridInfoMap;
  const mapped = map && typeof map === 'object' ? Object.values(map)[0] as any : null;
  const g = mapped ?? body;
  const lockView = firstFlag(g?.lockViewMember, g?.blockViewMember, g?.setting?.lockViewMember, g?.settings?.lockViewMember);
  const lockSend = firstFlag(g?.lockSendMsg, g?.lockSendMessage, g?.blockSendMessage, g?.setting?.lockSendMsg, g?.setting?.lockSendMessage, g?.settings?.lockSendMsg, g?.settings?.lockSendMessage);
  const memberCount = firstNumber(
    g?.totalMember,
    g?.memberCount,
    g?.membersCount,
    g?.totalMembers,
    Array.isArray(g?.currentMems) ? g.currentMems.length : undefined,
    Array.isArray(g?.memVerList) ? g.memVerList.length : undefined,
    Array.isArray(g?.members) ? g.members.length : undefined,
    fallback.memberCount,
  );
  const canViewMembers =
    firstFlag(g?.canViewMembers, g?.canViewMember, g?.viewMember, g?.setting?.canViewMembers, g?.settings?.canViewMembers) ??
    (lockView === null ? (Array.isArray(g?.currentMems) || Array.isArray(g?.memVerList) ? true : firstBool(fallback.canViewMembers)) : !lockView);
  const canSendMessage =
    firstFlag(g?.canSendMessage, g?.canSendMsg, g?.canChat, g?.setting?.canSendMessage, g?.settings?.canSendMessage) ??
    (lockSend === null ? firstBool(fallback.canSendMessage) : !lockSend);

  return {
    groupId: firstString(g?.groupId, g?.gridId, g?.grid, g?.id, body?.groupId, fallback.groupId),
    groupName: firstString(g?.name, g?.groupName, body?.name, body?.groupName, fallback.groupName),
    memberCount,
    canViewMembers,
    canSendMessage,
  };
}

async function joinedGroupIds(accountId: string): Promise<Set<string> | null> {
  try {
    const raw = await zaloOps.getAllGroups(accountId) as any;
    return new Set([...Object.keys(raw?.gridVerMap ?? {}), ...Object.keys(raw?.gridInfoMap ?? {})]);
  } catch {
    return null;
  }
}

async function syncJoinedLinks(accountId: string, orgId: string, ids: Set<string> | null) {
  const groupIds = [...(ids ?? [])].filter(Boolean);
  if (!groupIds.length) return;
  await prisma.zaloGroupLink.updateMany({
    where: {
      orgId,
      zaloAccountId: accountId,
      groupId: { in: groupIds },
      joinStatus: { notIn: ['joined', 'already_joined'] },
    },
    data: { joinStatus: 'already_joined', joinedAt: new Date(), lastCheckedAt: new Date(), lastError: null },
  });
}

function withMembership(link: any, ids: Set<string> | null) {
  const dbJoined = link.joinStatus === 'joined' || link.joinStatus === 'already_joined';
  const status = dbJoined ? 'joined' : ids && link.groupId ? (ids.has(link.groupId) ? 'joined' : 'not_joined') : 'unknown';
  return { ...link, accountJoined: status === 'joined', accountMembershipStatus: status };
}

function filterMembership(links: any[], status: unknown) {
  const value = String(status ?? '');
  return value ? links.filter((link) => link.accountMembershipStatus === value) : links;
}

function memberKey(row: any): string {
  return row.globalId || row.memberUid;
}

async function buildAudience(accountId: string, orgId: string, query: any) {
  const where: any = { orgId, zaloAccountId: accountId };
  if (query.groupId) where.groupId = String(query.groupId);
  if (query.isFriend !== undefined) where.isFriend = String(query.isFriend) === 'true';
  if (query.suppressed === 'true') where.suppressedAt = { not: null };
  if (query.suppressed === 'false') where.suppressedAt = null;
  if (query.contacted === 'true') where.privateMessageStatus = 'sent';
  if (query.contacted === 'false') where.OR = [{ privateMessageStatus: null }, { privateMessageStatus: { not: 'sent' } }];
  if (query.invited === 'true') where.friendInviteStatus = { not: null };
  if (query.invited === 'false') where.friendInviteStatus = null;
  if (query.friendInviteStatus) where.friendInviteStatus = String(query.friendInviteStatus);
  if (query.failed === 'true') where.OR = [{ privateMessageStatus: 'failed' }, { friendInviteStatus: 'failed' }];
  const q = String(query.q ?? '').trim();
  if (q) {
    where.AND = [
      ...(where.AND ?? []),
      { OR: [{ displayName: { contains: q, mode: 'insensitive' } }, { zaloName: { contains: q, mode: 'insensitive' } }, { memberUid: { contains: q } }] },
    ];
  }
  const rows = await prisma.groupMember.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    take: 20_000,
  });
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = memberKey(row);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, sourceGroups: [row.groupId], groupRows: [row.id] });
      continue;
    }
    if (!existing.sourceGroups.includes(row.groupId)) existing.sourceGroups.push(row.groupId);
    existing.groupRows.push(row.id);
    if (row.lastSeenAt > existing.lastSeenAt) {
      existing.displayName = row.displayName ?? existing.displayName;
      existing.zaloName = row.zaloName ?? existing.zaloName;
      existing.avatarUrl = row.avatarUrl ?? existing.avatarUrl;
      existing.lastSeenAt = row.lastSeenAt;
      existing.isFriend = row.isFriend;
    }
  }
  const members = [...map.values()];
  const stats = {
    total: members.length,
    friends: members.filter((m) => m.isFriend).length,
    strangers: members.filter((m) => !m.isFriend).length,
    contacted: members.filter((m) => m.privateMessageStatus === 'sent').length,
    contactFailed: members.filter((m) => m.privateMessageStatus === 'failed').length,
    invited: members.filter((m) => Boolean(m.friendInviteStatus)).length,
    inviteFailed: members.filter((m) => m.friendInviteStatus === 'failed').length,
    suppressed: members.filter((m) => m.suppressedAt).length,
  };
  return { members, stats };
}

async function listGroupLinks(accountId: string, orgId: string, query: any) {
  const currentGroupIds = await joinedGroupIds(accountId);
  await syncJoinedLinks(accountId, orgId, currentGroupIds);
  const where: any = { orgId, zaloAccountId: accountId };
  if (query.linkStatus) where.linkStatus = String(query.linkStatus);
  if (query.joinStatus) where.joinStatus = String(query.joinStatus);
  const canViewMembers = queryBool(query.canViewMembers);
  const canSendMessage = queryBool(query.canSendMessage);
  if (canViewMembers !== undefined) where.canViewMembers = canViewMembers;
  if (canSendMessage !== undefined) where.canSendMessage = canSendMessage;
  const q = String(query.q ?? '').trim();
  if (q) {
    where.OR = [
      { rawLink: { contains: q, mode: 'insensitive' } },
      { normalizedLink: { contains: q, mode: 'insensitive' } },
      { groupName: { contains: q, mode: 'insensitive' } },
      { linkId: { contains: q } },
    ];
  }
  const rawLinks = await prisma.zaloGroupLink.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  const statsRows = await prisma.zaloGroupLink.findMany({
    where: { orgId, zaloAccountId: accountId },
    select: { linkStatus: true, joinStatus: true, canSendMessage: true, canViewMembers: true, groupId: true },
  });
  const todayJoins = await prisma.zaloGroupLink.count({
    where: { orgId, zaloAccountId: accountId, joinStatus: 'joined', joinedAt: { gte: todayStart() } },
  });
  const statsLinks = statsRows.map((row) => withMembership(row, currentGroupIds));
  const stats = {
    total: statsRows.length,
    valid: statsRows.filter((r) => r.linkStatus === 'valid').length,
    invalid: statsRows.filter((r) => r.linkStatus === 'invalid').length,
    unchecked: statsRows.filter((r) => r.linkStatus === 'unchecked').length,
    dead: statsRows.filter((r) => r.linkStatus === 'dead').length,
    duplicate: statsRows.filter((r) => r.linkStatus === 'duplicate').length,
    notJoined: statsRows.filter((r) => r.joinStatus === 'not_joined').length,
    pending: statsRows.filter((r) => r.joinStatus === 'pending_approval' || r.joinStatus === 'join_requested').length,
    joined: statsRows.filter((r) => r.joinStatus === 'joined' || r.joinStatus === 'already_joined').length,
    failed: statsRows.filter((r) => r.joinStatus === 'failed').length,
    canSend: statsRows.filter((r) => r.canSendMessage === true).length,
    cannotSend: statsRows.filter((r) => r.canSendMessage === false).length,
    canViewMembers: statsRows.filter((r) => r.canViewMembers === true).length,
    cannotViewMembers: statsRows.filter((r) => r.canViewMembers === false).length,
    accountJoined: statsLinks.filter((r) => r.accountMembershipStatus === 'joined').length,
    accountNotJoined: statsLinks.filter((r) => r.accountMembershipStatus === 'not_joined').length,
    membershipUnknown: statsLinks.filter((r) => r.accountMembershipStatus === 'unknown').length,
    todayJoins,
  };
  return { links: filterMembership(rawLinks.map((link) => withMembership(link, currentGroupIds)), query.membershipStatus), stats };
}

async function checkRawZaloGroupLink(accountId: string, raw: string, fallback: any = {}) {
  const norm = normalizeGroupLink(raw);
  if (!norm.ok) return { ok: false as const, alive: false, norm, status: 'invalid', fields: null, error: norm.error ?? 'invalid_link' };
  try {
    const info = await zaloOps.getGroupLinkInfo(accountId, norm.normalizedLink);
    return { ok: true as const, alive: true, norm, status: 'valid', fields: groupInfoFields(info, fallback), error: null, result: info };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const dead = /expired|die|dead|invalid|not found|not exist|khÃ´ng tÃ¬m|háº¿t háº¡n|khÃ´ng tá»“n táº¡i/i.test(msg);
    return { ok: true as const, alive: false, norm, status: dead ? 'dead' : 'unknown', fields: null, error: msg };
  }
}

async function saveLiveZaloGroupLink(
  orgId: string,
  accountId: string,
  raw: string,
  fields: ReturnType<typeof groupInfoFields>,
  linkStatus = 'valid',
  lastError: string | null = null,
) {
  const norm = normalizeGroupLink(raw);
  if (!norm.ok) return null;
  const data = {
    linkStatus,
    groupId: fields.groupId,
    groupName: fields.groupName,
    memberCount: fields.memberCount,
    canViewMembers: fields.canViewMembers,
    canSendMessage: fields.canSendMessage,
    lastCheckedAt: new Date(),
    lastError,
  };
  const existing = await prisma.zaloGroupLink.findUnique({
    where: { zaloAccountId_normalizedLink: { zaloAccountId: accountId, normalizedLink: norm.normalizedLink } },
  });
  if (existing?.linkStatus === 'valid' && (linkStatus === 'unknown' || linkStatus === 'unchecked')) return existing;
  if (existing) {
    return prisma.zaloGroupLink.update({ where: { id: existing.id }, data });
  }
  return prisma.zaloGroupLink.create({
    data: { orgId, zaloAccountId: accountId, rawLink: norm.raw, normalizedLink: norm.normalizedLink, linkId: norm.linkId, ...data },
  });
}

async function syncDiscoveriesFromGroupLink(link: any) {
  if (!link?.id) return;
  await prisma.groupLinkDiscovery.updateMany({
    where: { savedZaloGroupLinkId: link.id },
    data: {
      checkStatus: link.linkStatus,
      title: link.groupName,
      memberCount: link.memberCount,
      canSendMessage: link.canSendMessage,
      canViewMembers: link.canViewMembers,
      lastCheckedAt: link.lastCheckedAt,
      lastError: link.lastError,
    },
  });
}

async function checkSavedZaloGroupLink(accountId: string, orgId: string, linkId: string) {
  const link = await prisma.zaloGroupLink.findFirst({ where: { id: linkId, orgId, zaloAccountId: accountId } });
  if (!link) return { ok: false, alive: false, error: 'link_not_found', link: null as any };

  const lastCheckedAt = link.lastCheckedAt?.getTime() ?? 0;
  // ponytail: a previously validated link is enough before join; join API still confirms current state.
  if (link.linkStatus === 'valid') {
    return { ok: true, alive: true, link, cached: true };
  }

  try {
    const info = await zaloOps.getGroupLinkInfo(accountId, link.normalizedLink);
    const fields = groupInfoFields(info, link);
    const updated = await prisma.zaloGroupLink.update({
      where: { id: link.id },
      data: {
        linkStatus: 'valid',
        groupId: fields.groupId,
        groupName: fields.groupName,
        memberCount: fields.memberCount,
        canViewMembers: fields.canViewMembers,
        canSendMessage: fields.canSendMessage,
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
    await syncDiscoveriesFromGroupLink(updated);
    return { ok: true, alive: true, link: updated, result: info };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (isRateLimitedCheck(msg)) {
      return { ok: false, alive: false, link, error: msg };
    }
    const dead = /expired|die|dead|invalid|not found|not exist|không tìm|hết hạn|không tồn tại/i.test(msg);
    const updated = await prisma.zaloGroupLink.update({
      where: { id: link.id },
      data: { linkStatus: dead ? 'dead' : 'unknown', lastError: msg, lastCheckedAt: new Date() },
    });
    await syncDiscoveriesFromGroupLink(updated);
    return { ok: true, alive: false, link: updated, error: msg };
  }
}

export async function joinSavedZaloGroupLink(accountId: string, orgId: string, linkId: string) {
  let link = await prisma.zaloGroupLink.findFirst({ where: { id: linkId, orgId, zaloAccountId: accountId } });
  if (!link) return { ok: false as const, statusCode: 404, error: 'link_not_found' };

  const checked = await checkSavedZaloGroupLink(accountId, orgId, link.id);
  link = checked.link;
  if (!checked.alive || !link || link.linkStatus !== 'valid') {
    return {
      ok: false as const,
      statusCode: isRateLimitedCheck(checked.error) ? 429 : 409,
      error: checked.error ?? 'link_not_valid',
      link,
    };
  }
  await prisma.zaloGroupLink.update({
    where: { id: link.id },
    data: { joinStatus: 'processing', lastCheckedAt: new Date(), lastError: null },
  });
  try {
    const result: any = await zaloOps.joinGroupByLink(accountId, link.normalizedLink);
    const text = JSON.stringify(result ?? {});
    const pending = /pending|wait|approve|duyet|duyệt/i.test(text);
    const joined = !pending;
    const fields = groupInfoFields(result, link);
    const updated = await prisma.zaloGroupLink.update({
      where: { id: link.id },
      data: {
        joinStatus: pending ? 'pending_approval' : 'joined',
        joinedAt: joined ? new Date() : null,
        lastCheckedAt: new Date(),
        groupId: fields.groupId,
        groupName: fields.groupName,
        memberCount: fields.memberCount,
        canViewMembers: fields.canViewMembers,
        canSendMessage: fields.canSendMessage ?? (joined ? true : null),
        lastError: null,
      },
    });
    await syncDiscoveriesFromGroupLink(updated);
    return { ok: true as const, link: updated, result, state: pending ? 'pending' : 'joined' };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (isRateLimitedJoin(err)) {
      const updated = await prisma.zaloGroupLink.update({
        where: { id: link.id },
        data: { joinStatus: 'not_joined', lastError: null, lastCheckedAt: link.lastCheckedAt },
      });
      await syncDiscoveriesFromGroupLink(updated);
      throw err;
    }
    if (isJoinApprovalPending(msg)) {
      const updated = await prisma.zaloGroupLink.update({
        where: { id: link.id },
        data: {
          joinStatus: 'pending_approval',
          linkStatus: 'valid',
          lastError: null,
          lastCheckedAt: new Date(),
        },
      });
      await syncDiscoveriesFromGroupLink(updated);
      return { ok: true as const, link: updated, result: null, state: 'pending' as const };
    }
    const linkStatus = /expired|die|dead|invalid|not found|không tìm|hết hạn/i.test(msg) ? 'dead' : undefined;
    await prisma.zaloGroupLink.update({
      where: { id: link.id },
      data: { joinStatus: 'failed', ...(linkStatus ? { linkStatus } : {}), lastError: msg, lastCheckedAt: new Date() },
    }).catch(() => {});
    throw err;
  }
}

const groupJoinRunning = new Set<string>();

async function serializeGroupJoinJob(job: any) {
  return {
    ...job,
    accountId: job.zaloAccountId,
    accountName: job.zaloAccount?.displayName ?? null,
    linkIds: Array.isArray(job.linkIds) ? job.linkIds.map(String) : [],
    logs: (job.logs ?? []).map((log: any) => ({ ...log, at: log.createdAt })),
  };
}

async function groupJoinTodayCount(orgId: string, accountId: string) {
  return prisma.groupJoinJobLog.count({
    where: {
      orgId,
      createdAt: { gte: todayStart() },
      state: { in: ['joined', 'pending', 'failed'] },
      job: { zaloAccountId: accountId },
    },
  });
}

async function groupJoinLinkIds(accountId: string, orgId: string, body: any, requestedIds: string[] = []) {
  const currentGroupIds = await joinedGroupIds(accountId);
  await syncJoinedLinks(accountId, orgId, currentGroupIds);
  const where: any = {
    orgId,
    zaloAccountId: accountId,
    joinStatus: { notIn: ['joined', 'already_joined'] },
  };
  const linkStatus = String(body.linkStatus ?? 'valid');
  if (linkStatus) where.linkStatus = linkStatus;
  const canSendMessage = queryBool(body.canSendMessage);
  const canViewMembers = queryBool(body.canViewMembers);
  if (canSendMessage !== undefined) where.canSendMessage = canSendMessage;
  if (canViewMembers !== undefined) where.canViewMembers = canViewMembers;
  if (requestedIds.length) where.id = { in: requestedIds };
  const links = await prisma.zaloGroupLink.findMany({
    where,
    select: { id: true, groupId: true, joinStatus: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_GROUP_JOIN_LINKS,
  });
  return filterMembership(links.map((link) => withMembership(link, currentGroupIds)), body.membershipStatus).map((link) => link.id);
}

async function runGroupJoinJob(jobId: string) {
  if (groupJoinRunning.has(jobId)) return;
  groupJoinRunning.add(jobId);
  try {
    let job = await prisma.groupJoinJob.findUnique({ where: { id: jobId } });
    if (!job || job.state === 'deleted' || job.state === 'stopped' || job.state === 'draft') return;
    await prisma.groupJoinJob.update({
      where: { id: jobId },
      data: { state: 'running', startedAt: job.startedAt ?? new Date(), finishedAt: null, lastError: null },
    });

    const linkIds = Array.isArray(job.linkIds) ? job.linkIds.map(String).filter(Boolean) : [];
    if (!linkIds.length) {
      await prisma.groupJoinJob.update({ where: { id: jobId }, data: { state: 'completed', finishedAt: new Date() } });
      return;
    }

    const alreadySuccessful = new Set(
      (await prisma.groupJoinJobLog.findMany({
        where: { jobId, state: { in: ['joined', 'pending', 'already_joined'] } },
        select: { linkId: true },
      })).map((row) => row.linkId),
    );
    const links = await prisma.zaloGroupLink.findMany({
      where: { id: { in: linkIds }, orgId: job.orgId, zaloAccountId: job.zaloAccountId },
      orderBy: { createdAt: 'asc' },
    });
    const linkById = new Map(links.map((link) => [link.id, link]));
    let dailyCount = await groupJoinTodayCount(job.orgId, job.zaloAccountId);

    for (const linkId of linkIds) {
      job = await prisma.groupJoinJob.findUnique({ where: { id: jobId } });
      if (!job || ['stopped', 'deleted'].includes(job.state)) return;
      if (job.stopAt && new Date() >= job.stopAt) {
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { state: 'stopped', finishedAt: new Date(), lastError: 'stop_time_reached' } });
        return;
      }
      if (dailyCount >= job.maxPerDay) {
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { state: 'waiting', nextRunAt: nextJoinRunAt() } });
        return;
      }
      if (alreadySuccessful.has(linkId)) continue;

      const link = linkById.get(linkId);
      if (!link) {
        await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state: 'skipped', error: 'link_not_found' } });
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { skipped: { increment: 1 } } });
        continue;
      }
      if (link.joinStatus === 'joined' || link.joinStatus === 'already_joined') {
        alreadySuccessful.add(linkId);
        await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state: 'already_joined' } });
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { skipped: { increment: 1 } } });
        continue;
      }
      if (link.linkStatus === 'dead') {
        await prisma.groupJoinJobLog.create({
          data: { jobId, orgId: job.orgId, linkId, state: 'skipped', error: 'link_dead' },
        });
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { skipped: { increment: 1 } } });
        continue;
      }

      try {
        const result = await joinSavedZaloGroupLink(job.zaloAccountId, job.orgId, linkId);
        if (!result.ok) {
          await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state: 'skipped', error: result.error } });
          await prisma.groupJoinJob.update({ where: { id: jobId }, data: { skipped: { increment: 1 }, lastError: result.error } });
          continue;
        }
        const state = result.state === 'pending' ? 'pending' : 'joined';
        await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state } });
        await prisma.groupJoinJob.update({
          where: { id: jobId },
          data: { joined: { increment: state === 'joined' ? 1 : 0 } },
        });
        alreadySuccessful.add(linkId);
        dailyCount += 1;
        logger.info(`[group-join] ${state} job=${jobId} account=${job.zaloAccountId} link=${linkId}`);
      } catch (err: any) {
        const error = String(err?.message ?? err);
        if (isRateLimitedJoin(err)) {
          await prisma.groupJoinJob.update({
            where: { id: jobId },
            data: { state: 'waiting', nextRunAt: nextJoinRunAt(), lastError: error },
          });
          return;
        }
        if (isJoinApprovalPending(error)) {
          await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state: 'pending' } });
          await prisma.groupJoinJob.update({ where: { id: jobId }, data: { lastError: null } });
          alreadySuccessful.add(linkId);
          dailyCount += 1;
          logger.info(`[group-join] pending job=${jobId} account=${job.zaloAccountId} link=${linkId}`);
          continue;
        }
        await prisma.groupJoinJobLog.create({ data: { jobId, orgId: job.orgId, linkId, state: 'failed', error } });
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { failed: { increment: 1 }, lastError: error } });
        dailyCount += 1;
      }

      const current = await prisma.groupJoinJob.findUnique({ where: { id: jobId } });
      if (!current || current.state === 'stopped') return;
      if (linkId !== linkIds[linkIds.length - 1]) await new Promise((resolve) => setTimeout(resolve, randomJoinDelay(current)));
    }

    await prisma.groupJoinJob.update({
      where: { id: jobId },
      data: { state: 'completed', nextRunAt: null, finishedAt: new Date() },
    });
  } catch (err: any) {
    await prisma.groupJoinJob.update({
      where: { id: jobId },
      data: { state: 'failed', lastError: String(err?.message ?? err), finishedAt: new Date() },
    }).catch(() => {});
  } finally {
    groupJoinRunning.delete(jobId);
  }
}

async function tickGroupJoinJobs() {
  const now = new Date();
  const jobs = await prisma.groupJoinJob.findMany({
    where: {
      state: { in: ['queued', 'running', 'waiting'] },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      AND: [{ OR: [{ stopAt: null }, { stopAt: { gt: now } }] }],
    },
    select: { id: true },
    take: 100,
  });
  for (const job of jobs) void runGroupJoinJob(job.id);
}

let groupJoinSchedulerStarted = false;
function startGroupJoinScheduler() {
  if (groupJoinSchedulerStarted || process.env.NODE_ENV === 'test') return;
  groupJoinSchedulerStarted = true;
  const timer = setInterval(() => void tickGroupJoinJobs().catch((err) => logger.warn({ err }, '[group-join] scheduler tick failed')), GROUP_JOIN_SCHEDULER_MS);
  timer.unref();
  setTimeout(() => void tickGroupJoinJobs().catch((err) => logger.warn({ err }, '[group-join] boot tick failed')), 5000).unref();
}

async function listDiscoveredLinks(orgId: string, accountIds: string[], query: any) {
  const requestedAccountId = String(query.accountId ?? '').trim();
  const visibleAccountIds = requestedAccountId
    ? (accountIds.includes(requestedAccountId) ? [requestedAccountId] : [])
    : accountIds;
  const where: any = { orgId, zaloAccountId: { in: visibleAccountIds } };
  if (query.platform) where.platform = String(query.platform);
  if (query.checkStatus) where.checkStatus = String(query.checkStatus);
  const q = String(query.q ?? '').trim();
  if (q) {
    where.OR = [
      { normalizedUrl: { contains: q, mode: 'insensitive' } },
      { rawUrl: { contains: q, mode: 'insensitive' } },
      { sourceThreadName: { contains: q, mode: 'insensitive' } },
      { title: { contains: q, mode: 'insensitive' } },
    ];
  }
  const limit = Math.max(1, Math.min(1000, Number(query.limit) || 200));
  const [items, statsRows, todayJoins] = await Promise.all([
    prisma.groupLinkDiscovery.findMany({
      where,
      orderBy: [{ messageSentAt: 'desc' }, { detectedAt: 'desc' }],
      take: limit,
    }),
    prisma.groupLinkDiscovery.findMany({ where, select: { platform: true, checkStatus: true, savedZaloGroupLinkId: true } }),
    prisma.zaloGroupLink.count({
      where: { orgId, zaloAccountId: { in: visibleAccountIds }, joinStatus: 'joined', joinedAt: { gte: todayStart() } },
    }),
  ]);
  return {
    items,
    stats: {
      total: statsRows.length,
      zalo: statsRows.filter((r) => r.platform === 'zalo').length,
      telegram: statsRows.filter((r) => r.platform === 'telegram').length,
      facebook: statsRows.filter((r) => r.platform === 'facebook').length,
      web: statsRows.filter((r) => r.platform === 'web').length,
      checked: statsRows.filter((r) => r.checkStatus !== 'unchecked').length,
      savedZalo: statsRows.filter((r) => r.checkStatus === 'valid' && Boolean(r.savedZaloGroupLinkId)).length,
      todayJoins,
    },
  };
}

async function listGroupLinkCrawlGroups(orgId: string, accountIds: string[], query: any) {
  const requestedAccountId = String(query.accountId ?? '').trim();
  const visibleAccountIds = requestedAccountId
    ? (accountIds.includes(requestedAccountId) ? [requestedAccountId] : [])
    : accountIds;
  const q = String(query.q ?? '').trim();
  const where: any = { orgId, zaloAccountId: { in: visibleAccountIds }, threadType: 'group' };
  if (q) {
    where.OR = [
      { groupName: { contains: q, mode: 'insensitive' } },
      { externalThreadId: { contains: q, mode: 'insensitive' } },
    ];
  }
  const conversations = await prisma.conversation.findMany({
    where,
    select: { id: true, zaloAccountId: true, externalThreadId: true, groupName: true, groupMembersCount: true, lastMessageAt: true },
    orderBy: { lastMessageAt: 'desc' },
    take: Math.max(1, Math.min(2000, Number(query.limit) || 500)),
  });
  const states = await prisma.groupLinkCrawlState.findMany({
    where: { orgId, zaloAccountId: { in: visibleAccountIds }, conversationId: { in: conversations.map((c) => c.id) } },
  });
  const stateByConversation = new Map(states.map((state) => [state.conversationId, state]));
  const items = conversations.map((conversation) => ({
    ...conversation,
    ...(stateByConversation.get(conversation.id) ?? {}),
    id: conversation.id,
    conversationId: conversation.id,
  }));
  return {
    items,
    stats: {
      totalGroups: conversations.length,
      crawledGroups: items.filter((item) => Boolean(item.lastCrawledAt)).length,
      uncrawledGroups: items.filter((item) => !item.lastCrawledAt).length,
    },
  };
}

async function crawlMessageLinks(orgId: string, accountIds: string[], body: any) {
  const limit = Math.max(1, Math.min(MAX_DISCOVERY_MESSAGES, Number(body?.limit) || DEFAULT_DISCOVERY_MESSAGES));
  const days = Math.max(1, Math.min(3650, Number(body?.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const selectedConversationIds = Array.isArray(body?.conversationIds)
    ? [...new Set(body.conversationIds.map((id: unknown) => String(id)).filter(Boolean))]
    : [];
  const conversationWhere: any = { orgId, zaloAccountId: { in: accountIds }, threadType: 'group' };
  if (selectedConversationIds.length) conversationWhere.id = { in: selectedConversationIds };
  const targetConversations = await prisma.conversation.findMany({
    where: conversationWhere,
    select: { id: true, zaloAccountId: true, externalThreadId: true, groupName: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 5000,
  });
  const targetConversationIds = targetConversations.map((conversation) => conversation.id);
  const stats = { crawledGroups: targetConversations.length, scannedMessages: 0, found: 0, inserted: 0, existing: 0, savedZalo: 0, savedUnverified: 0, checkedZalo: 0 };
  if (!targetConversationIds.length) return stats;
  const existingLinks = await prisma.groupLinkDiscovery.findMany({
    where: { orgId, zaloAccountId: { in: accountIds } },
    select: { zaloAccountId: true, normalizedUrl: true, checkStatus: true },
  });
  const seenLinks = new Map(existingLinks.map((link) => [
    `${link.zaloAccountId}:${link.normalizedUrl}`,
    link.checkStatus,
  ]));
  const processedLinks = new Set<string>();
  const rateLimitedAccounts = new Set<string>();
  const crawlByGroup = new Map(targetConversations.map((conversation) => [conversation.id, {
    conversation,
    scannedMessages: 0,
    foundLinks: 0,
    savedZaloLinks: 0,
    lastMessageSentAt: null as Date | null,
  }]));
  const messages = await prisma.message.findMany({
    where: {
      conversationId: { in: targetConversationIds },
      content: { not: null },
      sentAt: { gte: since },
    },
    include: { conversation: { select: { zaloAccountId: true, threadType: true, externalThreadId: true, groupName: true } } },
    orderBy: { sentAt: 'desc' },
    take: limit,
  });

  for (const message of messages) {
    stats.scannedMessages++;
    const groupState = crawlByGroup.get(message.conversationId);
    if (groupState) {
      groupState.scannedMessages++;
      if (!groupState.lastMessageSentAt || message.sentAt > groupState.lastMessageSentAt) groupState.lastMessageSentAt = message.sentAt;
    }
    const content = String(message.content ?? '');
    for (const raw of extractLinkCandidates(content)) {
      const candidate = classifyLink(raw);
      if (!candidate) continue;
      stats.found++;
      if (groupState) groupState.foundLinks++;
      const linkKey = `${message.conversation.zaloAccountId}:${candidate.normalizedUrl}`;
      const previousStatus = seenLinks.get(linkKey);
      const needsFirstCheck = candidate.platform === 'zalo' && previousStatus === 'unchecked' &&
        body?.autoCheck !== false && !rateLimitedAccounts.has(message.conversation.zaloAccountId);
      if (processedLinks.has(linkKey) || (previousStatus && !needsFirstCheck)) {
        stats.existing++;
        continue;
      }
      let savedZaloGroupLinkId: string | null = null;
      let checkStatus = 'unchecked';
      let title: string | null = null;
      let memberCount: number | null = null;
      let canSendMessage: boolean | null = null;
      let canViewMembers: boolean | null = null;
      let lastCheckedAt: Date | null = null;
      let lastError: string | null = null;

      if (candidate.platform === 'zalo') {
        if (body?.autoCheck !== false && !rateLimitedAccounts.has(message.conversation.zaloAccountId)) {
          const accountId = message.conversation.zaloAccountId;
          const checked = await checkRawZaloGroupLink(accountId, candidate.normalizedUrl);
          if (isRateLimitedCheck(checked.error)) rateLimitedAccounts.add(accountId);
          checkStatus = checked.status;
          lastCheckedAt = new Date();
          lastError = checked.error ?? null;
          stats.checkedZalo++;
          title = checked.fields?.groupName ?? null;
          memberCount = checked.fields?.memberCount ?? null;
          canSendMessage = checked.fields?.canSendMessage ?? null;
          canViewMembers = checked.fields?.canViewMembers ?? null;
          const saved = await saveLiveZaloGroupLink(
            orgId,
            message.conversation.zaloAccountId,
            candidate.normalizedUrl,
            checked.fields ?? groupInfoFields({}),
            checked.status,
            checked.error ?? null,
          );
          if (saved) {
            savedZaloGroupLinkId = saved.id;
            checkStatus = saved.linkStatus;
            title = saved.groupName ?? title;
            memberCount = saved.memberCount ?? memberCount;
            canSendMessage = saved.canSendMessage ?? canSendMessage;
            canViewMembers = saved.canViewMembers ?? canViewMembers;
            lastCheckedAt = saved.lastCheckedAt ?? lastCheckedAt;
            lastError = saved.lastError ?? lastError;
            if (saved.linkStatus === 'valid') {
              stats.savedZalo++;
              if (groupState) groupState.savedZaloLinks++;
            } else {
              stats.savedUnverified++;
            }
            await syncDiscoveriesFromGroupLink(saved);
          }
        }
        if (body?.autoCheck === false || !savedZaloGroupLinkId) {
          const saved = await saveLiveZaloGroupLink(
            orgId,
            message.conversation.zaloAccountId,
            candidate.normalizedUrl,
            groupInfoFields({}),
            'unchecked',
          );
          if (saved) {
            savedZaloGroupLinkId = saved.id;
            stats.savedUnverified++;
            await syncDiscoveriesFromGroupLink(saved);
          }
        }
      }

      const data = {
        orgId,
        zaloAccountId: message.conversation.zaloAccountId,
        conversationId: message.conversationId,
        messageId: message.id,
        platform: candidate.platform,
        linkKind: candidate.linkKind,
        rawUrl: candidate.rawUrl,
        normalizedUrl: candidate.normalizedUrl,
        externalKey: candidate.externalKey,
        sourceThreadType: message.conversation.threadType,
        sourceThreadId: message.conversation.externalThreadId,
        sourceThreadName: message.conversation.groupName,
        sourceSenderName: message.senderName,
        sourceSnippet: contentSnippet(content),
        messageSentAt: message.sentAt,
        checkStatus,
        title,
        memberCount,
        canSendMessage,
        canViewMembers,
        savedZaloGroupLinkId,
        lastCheckedAt,
        lastError,
      };
      await prisma.groupLinkDiscovery.upsert({
        where: {
          zaloAccountId_normalizedUrl: {
            zaloAccountId: message.conversation.zaloAccountId,
            normalizedUrl: candidate.normalizedUrl,
          },
        },
        create: data,
        update: data,
      });
      processedLinks.add(linkKey);
      if (previousStatus) stats.existing++;
      else stats.inserted++;
    }
  }
  const now = new Date();
  for (const state of crawlByGroup.values()) {
    await prisma.groupLinkCrawlState.upsert({
      where: { zaloAccountId_conversationId: { zaloAccountId: state.conversation.zaloAccountId, conversationId: state.conversation.id } },
      create: {
        orgId,
        zaloAccountId: state.conversation.zaloAccountId,
        conversationId: state.conversation.id,
        sourceThreadId: state.conversation.externalThreadId,
        sourceThreadName: state.conversation.groupName,
        lastCrawledAt: now,
        lastMessageSentAt: state.lastMessageSentAt,
        scannedMessages: state.scannedMessages,
        foundLinks: state.foundLinks,
        savedZaloLinks: state.savedZaloLinks,
        lastError: null,
      },
      update: {
        sourceThreadId: state.conversation.externalThreadId,
        sourceThreadName: state.conversation.groupName,
        lastCrawledAt: now,
        lastMessageSentAt: state.lastMessageSentAt,
        scannedMessages: state.scannedMessages,
        foundLinks: state.foundLinks,
        savedZaloLinks: state.savedZaloLinks,
        lastError: null,
      },
    });
  }
  return stats;
}

export async function groupAudienceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get<{ Params: { accountId: string }; Querystring: Record<string, unknown> }>(
    '/api/v1/zalo-accounts/:accountId/group-audience',
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;
        return await buildAudience(accountId, request.user!.orgId, request.query ?? {});
      } catch (err) { return handleError(reply, err, 'listGroupAudience'); }
    },
  );

  app.get<{ Params: { accountId: string }; Querystring: Record<string, unknown> }>(
    '/api/v1/zalo-accounts/:accountId/group-audience/export',
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const { members } = await buildAudience(accountId, request.user!.orgId, request.query ?? {});
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Thành viên quét');
        sheet.columns = [
          { header: 'UID', key: 'memberUid', width: 24 },
          { header: 'Tên hiển thị', key: 'displayName', width: 28 },
          { header: 'Tên Zalo', key: 'zaloName', width: 28 },
          { header: 'Bạn bè', key: 'isFriend', width: 12 },
          { header: 'Nhóm nguồn', key: 'sourceGroups', width: 48 },
          { header: 'Trạng thái IB', key: 'privateMessageStatus', width: 18 },
          { header: 'Lần IB gần nhất', key: 'privateMessageLastAt', width: 22 },
          { header: 'Trạng thái KB', key: 'friendInviteStatus', width: 18 },
          { header: 'Lần KB gần nhất', key: 'friendInviteLastAt', width: 22 },
          { header: 'Ghi chú', key: 'note', width: 36 },
        ];
        for (const m of members) {
          sheet.addRow({
            memberUid: m.memberUid,
            displayName: m.displayName,
            zaloName: m.zaloName,
            isFriend: m.isFriend ? 'Đã là bạn' : 'Người lạ',
            sourceGroups: m.sourceGroups.join(', '),
            privateMessageStatus: m.privateMessageStatus,
            privateMessageLastAt: m.privateMessageLastAt ?? null,
            friendInviteStatus: m.friendInviteStatus,
            friendInviteLastAt: m.friendInviteLastAt ?? null,
            note: m.note,
          });
        }
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        const buffer = await workbook.xlsx.writeBuffer();
        reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('content-disposition', `attachment; filename="group-audience-${accountId}.xlsx"`);
        return reply.send(Buffer.from(buffer as ArrayBuffer));
      } catch (err) { return handleError(reply, err, 'exportGroupAudience'); }
    },
  );

  app.patch<{ Params: { accountId: string; memberUid: string }; Body: Record<string, unknown> }>(
    '/api/v1/zalo-accounts/:accountId/group-audience/:memberUid',
    async (request, reply) => {
      const { accountId, memberUid } = request.params;
      const allowed: any = {};
      for (const key of ['privateMessageStatus', 'friendInviteStatus', 'lastFailureReason', 'note'] as const) {
        if (request.body?.[key] !== undefined) allowed[key] = request.body[key] ? String(request.body[key]) : null;
      }
      if (request.body?.privateMessageLastAt !== undefined) allowed.privateMessageLastAt = request.body.privateMessageLastAt ? new Date(String(request.body.privateMessageLastAt)) : null;
      if (request.body?.friendInviteLastAt !== undefined) allowed.friendInviteLastAt = request.body.friendInviteLastAt ? new Date(String(request.body.friendInviteLastAt)) : null;
      if (request.body?.suppressed !== undefined) allowed.suppressedAt = request.body.suppressed ? new Date() : null;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const result = await prisma.groupMember.updateMany({ where: { orgId: request.user!.orgId, zaloAccountId: accountId, memberUid }, data: allowed });
        return { ok: true, updated: result.count };
      } catch (err) { return handleError(reply, err, 'updateGroupAudienceMember'); }
    },
  );

  app.get<{ Params: { accountId: string }; Querystring: Record<string, unknown> }>(
    '/api/v1/zalo-accounts/:accountId/group-links',
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;
        return await listGroupLinks(accountId, request.user!.orgId, request.query ?? {});
      } catch (err) { return handleError(reply, err, 'listGroupLinks'); }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/v1/group-link-discoveries',
    async (request, reply) => {
      try {
        const accountIds = await getAccessibleZaloAccountIds(request.user!);
        if (!accountIds.length) return { items: [], stats: { total: 0 } };
        return await listDiscoveredLinks(request.user!.orgId, accountIds, request.query ?? {});
      } catch (err) { return handleError(reply, err, 'listGroupLinkDiscoveries'); }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    '/api/v1/group-link-crawl-groups',
    async (request, reply) => {
      try {
        const accountIds = await getAccessibleZaloAccountIds(request.user!);
        if (!accountIds.length) return { items: [], stats: { totalGroups: 0, crawledGroups: 0, uncrawledGroups: 0 } };
        return await listGroupLinkCrawlGroups(request.user!.orgId, accountIds, request.query ?? {});
      } catch (err) { return handleError(reply, err, 'listGroupLinkCrawlGroups'); }
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    '/api/v1/group-link-discoveries/crawl',
    async (request, reply) => {
      try {
        const allAccountIds = await getAccessibleZaloAccountIds(request.user!);
        const requestedAccountId = String(request.body?.accountId ?? '').trim();
        let accountIds = allAccountIds;
        if (requestedAccountId) {
          await resolveAccount(requestedAccountId, request.user!.orgId);
          if (!(await checkAccess(request, reply, requestedAccountId, 'read'))) return;
          accountIds = [requestedAccountId];
        }
        if (!accountIds.length) return { stats: { scannedMessages: 0, found: 0, inserted: 0, existing: 0, savedZalo: 0, checkedZalo: 0 } };
        const crawlStats = await crawlMessageLinks(request.user!.orgId, accountIds, request.body ?? {});
        return { crawlStats, ...(await listDiscoveredLinks(request.user!.orgId, accountIds, { limit: 200 })) };
      } catch (err) { return handleError(reply, err, 'crawlGroupLinkDiscoveries'); }
    },
  );

  app.post<{ Params: { accountId: string }; Body: { text?: string; links?: string[] } }>(
    '/api/v1/zalo-accounts/:accountId/group-links/import',
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const values = splitLinks(request.body ?? {});
        const batchLinkIds: string[] = [];
        const seen = new Set<string>();
        const stats = { total: values.length, valid: 0, invalid: 0, duplicate: 0, saved: 0, existing: 0 };
        for (const raw of values) {
          const norm = normalizeGroupLink(raw);
          if (!norm.ok) { stats.invalid++; continue; }
          stats.valid++;
          if (seen.has(norm.normalizedLink)) { stats.duplicate++; continue; }
          seen.add(norm.normalizedLink);
          const existing = await prisma.zaloGroupLink.findUnique({
            where: { zaloAccountId_normalizedLink: { zaloAccountId: accountId, normalizedLink: norm.normalizedLink } },
          });
          if (existing) { stats.existing++; batchLinkIds.push(existing.id); continue; }
          const created = await prisma.zaloGroupLink.create({
            data: { orgId: request.user!.orgId, zaloAccountId: accountId, rawLink: norm.raw, normalizedLink: norm.normalizedLink, linkId: norm.linkId, linkStatus: 'unchecked' },
          });
          batchLinkIds.push(created.id);
          stats.saved++;
        }
        return { ...(await listGroupLinks(accountId, request.user!.orgId, {})), importStats: { ...stats, batchLinkIds } };
      } catch (err) { return handleError(reply, err, 'importGroupLinks'); }
    },
  );

  app.post<{ Params: { accountId: string; linkId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-links/:linkId/check',
    async (request, reply) => {
        const { accountId, linkId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;
        const link = await prisma.zaloGroupLink.findFirst({ where: { id: linkId, orgId: request.user!.orgId, zaloAccountId: accountId } });
        if (!link) return reply.status(404).send({ error: 'link_not_found' });

        try {
           const info = await zaloOps.getGroupLinkInfo(accountId, link.normalizedLink);
          const fields = groupInfoFields(info, link);
          const updated = await prisma.zaloGroupLink.update({
            where: { id: link.id },
            data: {
              linkStatus: 'valid',
              groupId: fields.groupId,
              groupName: fields.groupName,
              memberCount: fields.memberCount,
              canViewMembers: fields.canViewMembers,
              canSendMessage: fields.canSendMessage,
              lastCheckedAt: new Date(),
              lastError: null,
            },
          });
          await syncDiscoveriesFromGroupLink(updated);
          return { ok: true, alive: true, link: updated, result: info };
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          const dead = /expired|die|dead|invalid|not found|not exist|không tìm|hết hạn|không tồn tại/i.test(msg);
          const updated = await prisma.zaloGroupLink.update({
            where: { id: link.id },
            data: { linkStatus: dead ? 'dead' : 'unknown', lastError: msg, lastCheckedAt: new Date() },
          });
          await syncDiscoveriesFromGroupLink(updated);
          return { ok: true, alive: false, link: updated, error: msg };
        }
      } catch (err) { return handleError(reply, err, 'checkGroupLink'); }
    },
  );

  app.post<{ Params: { accountId: string; linkId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-links/:linkId/join',
    async (request, reply) => {
      const { accountId, linkId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        let link = await prisma.zaloGroupLink.findFirst({ where: { id: linkId, orgId: request.user!.orgId, zaloAccountId: accountId } });
        if (!link) return reply.status(404).send({ error: 'link_not_found' });
        const checked = await checkSavedZaloGroupLink(accountId, request.user!.orgId, link.id);
        link = checked.link;
        if (!checked.alive || !link || link.linkStatus !== 'valid') {
          if (isRateLimitedCheck(checked.error)) {
            return reply.status(429).send({ error: checked.error, rateLimited: true, link });
          }
          return reply.status(409).send({ error: checked.error ?? 'link_not_valid', link });
        }
        await prisma.zaloGroupLink.update({ where: { id: link.id }, data: { joinStatus: 'processing', lastCheckedAt: new Date(), lastError: null } });
        const result: any = await zaloOps.joinGroupByLink(accountId, link.normalizedLink);
        const text = JSON.stringify(result ?? {});
        const pending = /pending|wait|approve|duyet|duyệt/i.test(text);
        const joined = !pending;
        const fields = groupInfoFields(result, link);
        const updated = await prisma.zaloGroupLink.update({
          where: { id: link.id },
          data: {
            joinStatus: pending ? 'pending_approval' : 'joined',
            joinedAt: joined ? new Date() : null,
            lastCheckedAt: new Date(),
            groupId: fields.groupId,
            groupName: fields.groupName,
            memberCount: fields.memberCount,
            canViewMembers: fields.canViewMembers,
            canSendMessage: fields.canSendMessage ?? (joined ? true : null),
            lastError: null,
          },
        });
        await syncDiscoveriesFromGroupLink(updated);
        return { link: updated, result };
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (isRateLimitedJoin(err)) {
          const reset = await prisma.zaloGroupLink.updateMany({
            where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId },
            data: { joinStatus: 'not_joined', lastError: null },
          });
          const link = reset.count
            ? await prisma.zaloGroupLink.findFirst({ where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId } })
            : null;
          if (link) await syncDiscoveriesFromGroupLink(link);
          return reply.status(429).send({ error: msg, rateLimited: true, link });
        }
        if (isJoinApprovalPending(msg)) {
          const pending = await prisma.zaloGroupLink.updateMany({
            where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId },
            data: {
              joinStatus: 'pending_approval',
              linkStatus: 'valid',
              lastError: null,
              lastCheckedAt: new Date(),
            },
          });
          const link = pending.count
            ? await prisma.zaloGroupLink.findFirst({ where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId } })
            : null;
          return reply.send({ link, state: 'pending_approval', pendingApproval: true });
        }
        const linkStatus = /expired|die|dead|invalid|not found|không tìm|hết hạn/i.test(msg) ? 'dead' : undefined;
        const failed = await prisma.zaloGroupLink.updateMany({
          where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId },
          data: { joinStatus: 'failed', ...(linkStatus ? { linkStatus } : {}), lastError: msg, lastCheckedAt: new Date() },
        });
        const link = failed.count
          ? await prisma.zaloGroupLink.findFirst({ where: { id: request.params.linkId, orgId: request.user!.orgId, zaloAccountId: request.params.accountId } })
          : null;
        return reply.status(409).send({ error: msg, link });
      }
    },
  );

  app.post<{
    Params: { accountId: string };
    Body: {
      linkIds?: string[];
      all?: boolean;
      maxPerDay?: number;
      delayMinSeconds?: number;
      delayMaxSeconds?: number;
      stopAt?: string;
      autoStart?: boolean;
      linkStatus?: string;
      canSendMessage?: string;
      canViewMembers?: string;
      membershipStatus?: string;
    };
  }>('/api/v1/zalo-accounts/:accountId/group-join-jobs', async (request, reply) => {
    const { accountId } = request.params;
    const body = request.body ?? {};
    try {
      const account = await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const requestedIds = Array.isArray(body.linkIds) ? [...new Set(body.linkIds.map(String).filter(Boolean))] : [];
      if (!body.all && !requestedIds.length) return reply.status(400).send({ error: 'linkIds required when all is not set' });
      if (requestedIds.length > MAX_GROUP_JOIN_LINKS) return reply.status(400).send({ error: `too many links (max ${MAX_GROUP_JOIN_LINKS})` });
      const maxPerDay = Math.max(1, Math.min(MAX_GROUP_JOIN_PER_DAY, Number(body.maxPerDay) || 20));
      const delay = parseJoinDelayRange(body);
      if (!delay) return reply.status(400).send({ error: 'delay range invalid (min >= 10s and max >= min)' });
      const stopAt = parseStopAt(body.stopAt);
      if (body.stopAt && !stopAt) return reply.status(400).send({ error: 'stopAt invalid' });
      const linkIds = await groupJoinLinkIds(accountId, account.orgId, body, body.all ? [] : requestedIds);
      if (!linkIds.length) return reply.status(400).send({ error: 'no_joinable_links' });
      const job = await prisma.groupJoinJob.create({
        data: {
          orgId: account.orgId,
          zaloAccountId: accountId,
          linkIds,
          maxPerDay,
          ...delay,
          stopAt: stopAt ?? undefined,
          state: body.autoStart ? 'queued' : 'draft',
          createdById: request.user!.id,
        },
        include: {
          zaloAccount: { select: { displayName: true } },
          logs: { orderBy: { createdAt: 'desc' }, take: 500 },
        },
      });
      if (body.autoStart) void runGroupJoinJob(job.id);
      return reply.status(201).send({ job: await serializeGroupJoinJob(job) });
    } catch (err) {
      return handleError(reply, err, 'createGroupJoinJob');
    }
  });

  app.get<{ Params: { accountId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-join-jobs',
    async (request, reply) => {
      const { accountId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const jobs = await prisma.groupJoinJob.findMany({
          where: { orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            zaloAccount: { select: { displayName: true } },
            logs: { orderBy: { createdAt: 'desc' }, take: 500 },
          },
        });
        return { jobs: await Promise.all(jobs.map(serializeGroupJoinJob)) };
      } catch (err) {
        return handleError(reply, err, 'listGroupJoinJobs');
      }
    },
  );

  app.post<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-join-jobs/:jobId/start',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const job = await prisma.groupJoinJob.findFirst({
          where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { in: ['draft', 'stopped', 'waiting', 'completed', 'failed'] } },
        });
        if (!job) return reply.status(404).send({ error: 'job_not_found_or_not_startable' });
        const updated = await prisma.groupJoinJob.update({
          where: { id: jobId },
          data: { state: 'queued', nextRunAt: null, finishedAt: null, lastError: null },
          include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 500 } },
        });
        void runGroupJoinJob(jobId);
        return { job: await serializeGroupJoinJob(updated) };
      } catch (err) {
        return handleError(reply, err, 'startGroupJoinJob');
      }
    },
  );

  app.post<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-join-jobs/:jobId/stop',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const job = await prisma.groupJoinJob.findFirst({
          where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { not: 'deleted' } },
        });
        if (!job) return reply.status(404).send({ error: 'job_not_found' });
        const updated = await prisma.groupJoinJob.update({
          where: { id: jobId },
          data: { state: 'stopped', nextRunAt: null, finishedAt: new Date() },
          include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 500 } },
        });
        return { job: await serializeGroupJoinJob(updated) };
      } catch (err) {
        return handleError(reply, err, 'stopGroupJoinJob');
      }
    },
  );

  app.patch<{
    Params: { accountId: string; jobId: string };
    Body: { linkIds?: string[]; maxPerDay?: number; delayMinSeconds?: number; delayMaxSeconds?: number; stopAt?: string | null; linkStatus?: string; canSendMessage?: string; canViewMembers?: string; membershipStatus?: string };
  }>('/api/v1/zalo-accounts/:accountId/group-join-jobs/:jobId', async (request, reply) => {
    const { accountId, jobId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
      const job = await prisma.groupJoinJob.findFirst({
        where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId, state: { in: ['draft', 'stopped', 'waiting', 'completed', 'failed'] } },
      });
      if (!job) return reply.status(409).send({ error: 'job_not_editable' });
      const linkIds = request.body?.linkIds?.length
        ? [...new Set(request.body.linkIds.map(String).filter(Boolean))]
        : undefined;
      if (linkIds && linkIds.length > MAX_GROUP_JOIN_LINKS) return reply.status(400).send({ error: `too many links (max ${MAX_GROUP_JOIN_LINKS})` });
      if (linkIds) {
        const filteredIds = await groupJoinLinkIds(accountId, request.user!.orgId, request.body ?? {}, linkIds);
        if (!filteredIds.length) return reply.status(400).send({ error: 'no_joinable_links' });
        linkIds.splice(0, linkIds.length, ...filteredIds);
      }
      const delayTouched = request.body?.delayMinSeconds !== undefined || request.body?.delayMaxSeconds !== undefined;
      const delay = delayTouched ? parseJoinDelayRange(request.body) : null;
      if (delayTouched && !delay) return reply.status(400).send({ error: 'delay range invalid (min >= 10s and max >= min)' });
      const stopAt = request.body?.stopAt === undefined ? undefined : parseStopAt(request.body.stopAt);
      if (request.body?.stopAt && !stopAt) return reply.status(400).send({ error: 'stopAt invalid' });
      const updated = await prisma.groupJoinJob.update({
        where: { id: jobId },
        data: {
          ...(linkIds ? { linkIds } : {}),
          ...(request.body?.maxPerDay !== undefined ? { maxPerDay: Math.max(1, Math.min(MAX_GROUP_JOIN_PER_DAY, Number(request.body.maxPerDay) || job.maxPerDay)) } : {}),
          ...(delay ? delay : {}),
          ...(request.body?.stopAt !== undefined ? { stopAt } : {}),
        },
        include: { zaloAccount: { select: { displayName: true } }, logs: { orderBy: { createdAt: 'desc' }, take: 500 } },
      });
      return { job: await serializeGroupJoinJob(updated) };
    } catch (err) {
      return handleError(reply, err, 'updateGroupJoinJob');
    }
  });

  app.delete<{ Params: { accountId: string; jobId: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-join-jobs/:jobId',
    async (request, reply) => {
      const { accountId, jobId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const job = await prisma.groupJoinJob.findFirst({
          where: { id: jobId, orgId: request.user!.orgId, zaloAccountId: accountId },
          select: { id: true },
        });
        if (!job) return reply.status(404).send({ error: 'job_not_found' });
        await prisma.groupJoinJob.update({ where: { id: jobId }, data: { state: 'deleted', finishedAt: new Date() } });
        return { ok: true };
      } catch (err) {
        return handleError(reply, err, 'deleteGroupJoinJob');
      }
    },
  );

  app.patch<{ Params: { accountId: string; linkId: string }; Body: { note?: string; linkStatus?: string; joinStatus?: string } }>(
    '/api/v1/zalo-accounts/:accountId/group-links/:linkId',
    async (request, reply) => {
      const { accountId, linkId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'chat'))) return;
        const existing = await prisma.zaloGroupLink.findFirst({ where: { id: linkId, orgId: request.user!.orgId, zaloAccountId: accountId }, select: { id: true } });
        if (!existing) return reply.status(404).send({ error: 'link_not_found' });
        const link = await prisma.zaloGroupLink.update({
          where: { id: linkId },
          data: {
            ...(request.body.note !== undefined ? { note: request.body.note } : {}),
            ...(request.body.linkStatus ? { linkStatus: request.body.linkStatus } : {}),
            ...(request.body.joinStatus ? { joinStatus: request.body.joinStatus } : {}),
          },
        });
        return { link };
      } catch (err) { return handleError(reply, err, 'updateGroupLink'); }
    },
  );

  startGroupJoinScheduler();
}
