// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Composable wrapping all group management API endpoints.
 * All methods take accountId as first param (from useSelectedAccount).
 */
import { ref } from 'vue';
import { api } from '@/api/index';

/** GroupScan lifecycle states returned by the backend. */
export type GroupScanState = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface GroupScan {
  id: string;
  state: GroupScanState;
  scope: 'selected' | 'all' | string;
  groupIds: string[];
  totalGroups: number;
  scannedGroups: number;
  memberCount: number;
  [key: string]: any;
}

export interface GroupScanMember {
  id: string;
  memberUid: string;
  displayName: string;
  zaloName: string;
  avatarUrl: string;
  isAdmin: boolean;
  isFriend: boolean;
  harvestedAt: string;
  [key: string]: any;
}

export function useGroups() {
  const groups = ref<any[]>([]);
  const selectedGroup = ref<any | null>(null);
  const members = ref<any[]>([]);
  const blocked = ref<any[]>([]);
  const pending = ref<any[]>([]);
  const loading = ref(false);
  const actionLoading = ref(false);

  /* ── Group scan (feature E1) reactive state ── */
  const scan = ref<GroupScan | null>(null);
  const scanMembers = ref<GroupScanMember[]>([]);
  const groupSendJobs = ref<any[]>([]);
  const scanLoading = ref(false);
  const scanMembersLoading = ref(false);

  const base = (accountId: string) => `/zalo-accounts/${accountId}/groups`;
  const scanBase = (accountId: string) => `/zalo-accounts/${accountId}/group-scans`;

  async function fetchGroups(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(base(accountId));
      groups.value = res.data.groups ?? [];
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchGroup(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}`);
      selectedGroup.value = res.data.group;
      return res.data.group;
    } catch (err) {
      console.error('Failed to fetch group:', err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchMembers(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/members`);
      members.value = res.data.members ?? [];
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      loading.value = false;
    }
  }

  async function createGroup(accountId: string, payload: { name: string; memberIds: string[] }) {
    actionLoading.value = true;
    try {
      const res = await api.post(base(accountId), payload);
      await fetchGroups(accountId);
      return res.data.group;
    } catch (err) {
      console.error('Failed to create group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function renameGroup(accountId: string, groupId: string, name: string) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`${base(accountId)}/${groupId}/name`, { name });
      return res.data.result;
    } catch (err) {
      console.error('Failed to rename group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function updateSettings(accountId: string, groupId: string, settings: Record<string, any>) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`${base(accountId)}/${groupId}/settings`, settings);
      return res.data.result;
    } catch (err) {
      console.error('Failed to update settings:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function addMembers(accountId: string, groupId: string, userIds: string[]) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/members`, { userIds });
      return res.data.result;
    } catch (err) {
      console.error('Failed to add members:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function removeMembers(accountId: string, groupId: string, userIds: string[]) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/members`, { data: { userIds } });
      return res.data.result;
    } catch (err) {
      console.error('Failed to remove members:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function addDeputy(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/deputies`, { userId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to add deputy:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function removeDeputy(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/deputies/${userId}`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to remove deputy:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function transferOwnership(accountId: string, groupId: string, newOwnerId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/transfer`, { newOwnerId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to transfer ownership:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function blockMember(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/block`, { userId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to block member:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function unblockMember(accountId: string, groupId: string, userId: string) {
    actionLoading.value = true;
    try {
      const res = await api.delete(`${base(accountId)}/${groupId}/block/${userId}`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to unblock member:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchBlocked(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/blocked`);
      blocked.value = res.data.blocked ?? [];
    } catch (err) {
      console.error('Failed to fetch blocked:', err);
    } finally {
      loading.value = false;
    }
  }

  async function fetchPending(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/pending`);
      pending.value = res.data.pending ?? [];
    } catch (err) {
      console.error('Failed to fetch pending:', err);
    } finally {
      loading.value = false;
    }
  }

  async function getInviteLink(accountId: string, groupId: string) {
    try {
      const res = await api.get(`${base(accountId)}/${groupId}/link`);
      return res.data.link;
    } catch (err) {
      console.error('Failed to get invite link:', err);
      return null;
    }
  }

  async function enableInviteLink(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/link/enable`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to enable invite link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function disableInviteLink(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/link/disable`);
      return res.data.result;
    } catch (err) {
      console.error('Failed to disable invite link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function joinByLink(accountId: string, linkId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/groups/join-link`, { linkId });
      return res.data.result;
    } catch (err) {
      console.error('Failed to join group by link:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function leaveGroup(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/leave`);
      await fetchGroups(accountId);
      return res.data.result;
    } catch (err) {
      console.error('Failed to leave group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function disperseGroup(accountId: string, groupId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`${base(accountId)}/${groupId}/disperse`);
      await fetchGroups(accountId);
      return res.data.result;
    } catch (err) {
      console.error('Failed to disperse group:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  /* ── Group scan (feature E1) ── */

  /** Kick off a scan. Pass { all: true } to scan every group, or { groupIds }. */
  async function createScan(
    accountId: string,
    payload: { groupIds?: string[]; all?: boolean },
  ): Promise<GroupScan | null> {
    scanLoading.value = true;
    try {
      const res = await api.post(scanBase(accountId), payload);
      // Backend bọc trong { scan }. Unwrap (fallback res.data nếu sau này trả phẳng).
      scan.value = res.data?.scan ?? res.data ?? null;
      return scan.value;
    } catch (err) {
      console.error('Failed to create group scan:', err);
      return null;
    } finally {
      scanLoading.value = false;
    }
  }

  /** Poll a scan's current status. Updates `scan` and returns the latest snapshot. */
  async function fetchScanStatus(accountId: string, scanId: string): Promise<GroupScan | null> {
    try {
      const res = await api.get(`${scanBase(accountId)}/${scanId}`);
      // Backend bọc trong { scan }. Unwrap (fallback res.data nếu trả phẳng).
      scan.value = res.data?.scan ?? res.data ?? null;
      return scan.value;
    } catch (err) {
      console.error('Failed to fetch scan status:', err);
      return null;
    }
  }

  /** Fetch harvested members for a scan, optionally filtered by friend status. */
  async function fetchScanMembers(
    accountId: string,
    scanId: string,
    opts: { isFriend?: boolean; page?: number; limit?: number } = {},
  ): Promise<{ members: GroupScanMember[]; total: number }> {
    scanMembersLoading.value = true;
    try {
      const params: Record<string, any> = {};
      if (opts.isFriend !== undefined) params.isFriend = opts.isFriend;
      if (opts.page !== undefined) params.page = opts.page;
      if (opts.limit !== undefined) params.limit = opts.limit;
      const res = await api.get(`${scanBase(accountId)}/${scanId}/members`, { params });
      scanMembers.value = res.data.members ?? [];
      return { members: scanMembers.value, total: res.data.total ?? scanMembers.value.length };
    } catch (err) {
      console.error('Failed to fetch scan members:', err);
      return { members: [], total: 0 };
    } finally {
      scanMembersLoading.value = false;
    }
  }

  function exportScanMembers(accountId: string, scanId: string, opts: { isFriend?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opts.isFriend !== undefined) params.set('isFriend', String(opts.isFriend));
    const qs = params.toString();
    window.open(`/api/v1${scanBase(accountId)}/${scanId}/export.csv${qs ? `?${qs}` : ''}`, '_blank');
  }

  async function saveScanContacts(
    accountId: string,
    scanId: string,
    opts: { isFriend?: boolean } = {},
  ): Promise<{ created: number; updated: number; total: number } | null> {
    actionLoading.value = true;
    try {
      const res = await api.post(`${scanBase(accountId)}/${scanId}/save-contacts`, opts);
      return res.data;
    } catch (err) {
      console.error('Failed to save scan contacts:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function createGroupSendJob(
    accountId: string,
    payload: {
      groupIds: string[];
      message: string;
      delaySeconds: number;
      delayMinSeconds?: number;
      delayMaxSeconds?: number;
      stopAt?: string;
      repeat?: boolean;
      repeatEveryMinutes?: number;
      autoStart?: boolean;
      sourceType?: string;
      imageAttachments?: Array<{ name?: string; mimeType: string; data?: string; path?: string; url?: string; size?: number }>;
    },
  ) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-send-jobs`, payload);
      await fetchGroupSendJobs(accountId);
      return res.data.job;
    } catch (err) {
      console.error('Failed to create group send job:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function uploadGroupSendImages(accountId: string, files: File[]) {
    actionLoading.value = true;
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file, file.name));
      const res = await api.post(`/zalo-accounts/${accountId}/group-send-images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.images ?? [];
    } catch (err) {
      console.error('Failed to upload group send images:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchGroupSendJobs(accountId: string) {
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/group-send-jobs`);
      groupSendJobs.value = res.data.jobs ?? [];
      return groupSendJobs.value;
    } catch (err) {
      console.error('Failed to fetch group send jobs:', err);
      return [];
    }
  }

  async function stopGroupSendJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-send-jobs/${jobId}/stop`);
      await fetchGroupSendJobs(accountId);
      return res.data.job;
    } catch (err) {
      console.error('Failed to stop group send job:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function startGroupSendJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-send-jobs/${jobId}/start`);
      await fetchGroupSendJobs(accountId);
      return res.data.job;
    } catch (err) {
      console.error('Failed to start group send job:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function updateGroupSendJob(
    accountId: string,
    jobId: string,
    payload: { groupIds?: string[]; message?: string; delaySeconds?: number; delayMinSeconds?: number; delayMaxSeconds?: number; stopAt?: string | null; repeat?: boolean; repeatEveryMinutes?: number; sourceType?: string; imageAttachments?: Array<{ name?: string; mimeType: string; data?: string; path?: string; url?: string; size?: number }> },
  ) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`/zalo-accounts/${accountId}/group-send-jobs/${jobId}`, payload);
      await fetchGroupSendJobs(accountId);
      return res.data.job;
    } catch (err) {
      console.error('Failed to update group send job:', err);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  async function deleteGroupSendJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      await api.delete(`/zalo-accounts/${accountId}/group-send-jobs/${jobId}`);
      await fetchGroupSendJobs(accountId);
      return true;
    } catch (err) {
      console.error('Failed to delete group send job:', err);
      return false;
    } finally {
      actionLoading.value = false;
    }
  }

  return {
    groups, selectedGroup, members, blocked, pending,
    loading, actionLoading,
    fetchGroups, fetchGroup, fetchMembers,
    createGroup, renameGroup, updateSettings,
    addMembers, removeMembers,
    addDeputy, removeDeputy, transferOwnership,
    blockMember, unblockMember,
    fetchBlocked, fetchPending,
    getInviteLink, enableInviteLink, disableInviteLink, joinByLink,
    leaveGroup, disperseGroup,
    // Group scan (feature E1)
    scan, scanMembers, groupSendJobs, scanLoading, scanMembersLoading,
    createScan, fetchScanStatus, fetchScanMembers,
    exportScanMembers, saveScanContacts, uploadGroupSendImages, createGroupSendJob, fetchGroupSendJobs,
    stopGroupSendJob, startGroupSendJob, updateGroupSendJob, deleteGroupSendJob,
  };
}
