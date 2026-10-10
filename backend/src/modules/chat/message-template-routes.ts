// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

type TemplateBody = {
  name?: string;
  shortcut?: string | null;
  content?: string;
  contentRich?: { text?: string; styles?: Array<{ st: string; start: number; len: number }> } | null;
  category?: string | null;
  visibility?: 'public' | 'private';
  folderId?: string | null;
  tagIds?: string[];
};

type TemplateQuery = {
  search?: string;
  category?: string;
  visibility?: string;
  folderId?: string;
  includeArchived?: string;
};

function normalizeShortcut(value?: string | null): string | null {
  const out = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, '')
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  return out || null;
}

function defaultName(content: string): string {
  return content.split(/\r?\n/).find(Boolean)?.slice(0, 60) || 'Tin nhắn nhanh';
}

function serializeTemplate(t: any, userId: string) {
  return {
    ...t,
    isPersonal: t.visibility !== 'public',
    isMine: t.createdById === userId || t.ownerUserId === userId,
  };
}

function readWhere(user: { id: string; orgId: string }, query: TemplateQuery) {
  const and: any[] = [
    {
      OR: [
        { visibility: 'public' },
        { createdById: user.id },
        { ownerUserId: user.id },
      ],
    },
  ];
  if (query.includeArchived !== 'true') and.push({ archivedAt: null });
  if (query.folderId) and.push({ folderId: query.folderId });
  if (query.category) and.push({ category: query.category });
  if (query.visibility === 'public' || query.visibility === 'private') and.push({ visibility: query.visibility });
  const search = query.search?.trim();
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { shortcut: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  return { orgId: user.orgId, AND: and };
}

async function findEditable(id: string, user: { id: string; orgId: string; role: string }) {
  return prisma.messageTemplate.findFirst({
    where: {
      id,
      orgId: user.orgId,
      OR: [
        { createdById: user.id },
        { ownerUserId: user.id },
        ...(user.role === 'owner' || user.role === 'admin' ? [{ id }] : []),
      ],
    },
  });
}

function normalizePayload(body: TemplateBody) {
  const content = String(body.contentRich?.text ?? body.content ?? '').trim();
  if (!content) return null;
  const name = String(body.name || defaultName(content)).trim().slice(0, 120);
  return {
    name,
    shortcut: normalizeShortcut(body.shortcut),
    content,
    contentRich: body.contentRich?.text ? body.contentRich : { text: content, styles: [] },
    category: body.category?.trim() || 'quick',
    visibility: body.visibility === 'public' ? 'public' : 'private',
    folderId: body.folderId || null,
    tagIds: Array.isArray(body.tagIds) ? body.tagIds.filter((x) => typeof x === 'string') : [],
  };
}

export async function messageTemplateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/automation/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const query = request.query as TemplateQuery;
    try {
      const templates = await prisma.messageTemplate.findMany({
        where: readWhere(user, query),
        orderBy: [{ manualSendCount: 'desc' }, { updatedAt: 'desc' }],
        take: 200,
      });
      return { templates: templates.map((t) => serializeTemplate(t, user.id)) };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Không tải được mẫu tin nhắn' });
    }
  });

  app.post('/api/v1/automation/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const payload = normalizePayload((request.body ?? {}) as TemplateBody);
    if (!payload) return reply.status(400).send({ error: 'content is required' });
    try {
      const template = await prisma.messageTemplate.create({
        data: {
          ...payload,
          orgId: user.orgId,
          ownerUserId: user.id,
          createdById: user.id,
        },
      });
      return reply.status(201).send(serializeTemplate(template, user.id));
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Không lưu được mẫu tin nhắn' });
    }
  });

  app.put('/api/v1/automation/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const payload = normalizePayload((request.body ?? {}) as TemplateBody);
    if (!payload) return reply.status(400).send({ error: 'content is required' });
    try {
      const existing = await findEditable(id, user);
      if (!existing) return reply.status(404).send({ error: 'template_not_found' });
      const template = await prisma.messageTemplate.update({ where: { id }, data: payload });
      return serializeTemplate(template, user.id);
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Không sửa được mẫu tin nhắn' });
    }
  });

  app.delete('/api/v1/automation/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    try {
      const existing = await findEditable(id, user);
      if (!existing) return reply.status(404).send({ error: 'template_not_found' });
      await prisma.messageTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
      return { ok: true };
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Không xóa được mẫu tin nhắn' });
    }
  });

  app.post('/api/v1/automation/templates/:id/track-use', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    try {
      const found = await prisma.messageTemplate.findFirst({ where: { id, orgId: user.orgId }, select: { id: true } });
      if (!found) return reply.status(404).send({ error: 'template_not_found' });
      await prisma.messageTemplate.update({
        where: { id },
        data: {
          usageCount: { increment: 1 },
          manualSendCount: { increment: 1 },
          lastUsedAt: new Date(),
          lastManualSentAt: new Date(),
        },
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  app.get('/api/v1/automation/template-folders', async (_request, _reply) => ({ folders: [] }));
}
