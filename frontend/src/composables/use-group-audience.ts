import { ref } from 'vue';
import { api } from '@/api/index';

export function useGroupAudience() {
  const members = ref<any[]>([]);
  const memberStats = ref<any>({});
  const links = ref<any[]>([]);
  const linkStats = ref<any>({});
  const discoveredLinks = ref<any[]>([]);
  const discoveryStats = ref<any>({});
  const crawlGroups = ref<any[]>([]);
  const crawlGroupStats = ref<any>({});
  const joinJobs = ref<any[]>([]);
  const loading = ref(false);
  const actionLoading = ref(false);

  async function fetchAudience(accountId: string, params: Record<string, any> = {}) {
    loading.value = true;
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/group-audience`, { params });
      members.value = res.data.members ?? [];
      memberStats.value = res.data.stats ?? {};
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function exportAudience(accountId: string, params: Record<string, any> = {}) {
    const res = await api.get(`/zalo-accounts/${accountId}/group-audience/export`, { params, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `group-audience-${accountId}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function updateAudienceMember(accountId: string, memberUid: string, payload: Record<string, any>) {
    actionLoading.value = true;
    try {
      await api.patch(`/zalo-accounts/${accountId}/group-audience/${memberUid}`, payload);
      return true;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchGroupLinks(accountId: string, params: Record<string, any> = {}) {
    loading.value = true;
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/group-links`, { params });
      links.value = res.data.links ?? [];
      linkStats.value = res.data.stats ?? {};
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function importGroupLinks(accountId: string, text: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-links/import`, { text });
      links.value = res.data.links ?? [];
      linkStats.value = res.data.stats ?? {};
      return res.data.importStats;
    } finally {
      actionLoading.value = false;
    }
  }

  async function joinGroupLink(accountId: string, linkId: string, refresh = true) {
    if (refresh) actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-links/${linkId}/join`);
      if (refresh) await fetchGroupLinks(accountId);
      return res.data.link;
    } finally {
      if (refresh) actionLoading.value = false;
    }
  }

  async function checkGroupLink(accountId: string, linkId: string, refresh = true) {
    if (refresh) actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-links/${linkId}/check`);
      if (refresh) await fetchGroupLinks(accountId);
      return res.data;
    } finally {
      if (refresh) actionLoading.value = false;
    }
  }

  async function updateGroupLink(accountId: string, linkId: string, payload: Record<string, any>) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`/zalo-accounts/${accountId}/group-links/${linkId}`, payload);
      await fetchGroupLinks(accountId);
      return res.data.link;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchGroupLinkDiscoveries(params: Record<string, any> = {}) {
    loading.value = true;
    try {
      const res = await api.get('/group-link-discoveries', { params });
      discoveredLinks.value = res.data.items ?? [];
      discoveryStats.value = res.data.stats ?? {};
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function crawlGroupLinkDiscoveries(payload: Record<string, any> = {}) {
    actionLoading.value = true;
    try {
      // Crawling thousands of stored messages may exceed the global 30s API
      // timeout. Keep request alive while backend finishes; other API calls
      // retain the normal timeout.
      const res = await api.post('/group-link-discoveries/crawl', payload, {
        timeout: 10 * 60_000,
      });
      discoveredLinks.value = res.data.items ?? [];
      discoveryStats.value = res.data.stats ?? {};
      return res.data;
    } finally {
      actionLoading.value = false;
    }
  }

  async function fetchGroupLinkCrawlGroups(params: Record<string, any> = {}) {
    loading.value = true;
    try {
      const res = await api.get('/group-link-crawl-groups', { params });
      crawlGroups.value = res.data.items ?? [];
      crawlGroupStats.value = res.data.stats ?? {};
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function fetchGroupJoinJobs(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/group-join-jobs`);
      joinJobs.value = res.data.jobs ?? [];
      return joinJobs.value;
    } finally {
      loading.value = false;
    }
  }

  async function createGroupJoinJob(accountId: string, payload: Record<string, any>) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-join-jobs`, payload);
      await fetchGroupJoinJobs(accountId);
      return res.data.job;
    } finally {
      actionLoading.value = false;
    }
  }

  async function updateGroupJoinJob(accountId: string, jobId: string, payload: Record<string, any>) {
    actionLoading.value = true;
    try {
      const res = await api.patch(`/zalo-accounts/${accountId}/group-join-jobs/${jobId}`, payload);
      await fetchGroupJoinJobs(accountId);
      return res.data.job;
    } finally {
      actionLoading.value = false;
    }
  }

  async function startGroupJoinJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-join-jobs/${jobId}/start`);
      await fetchGroupJoinJobs(accountId);
      return res.data.job;
    } finally {
      actionLoading.value = false;
    }
  }

  async function stopGroupJoinJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      const res = await api.post(`/zalo-accounts/${accountId}/group-join-jobs/${jobId}/stop`);
      await fetchGroupJoinJobs(accountId);
      return res.data.job;
    } finally {
      actionLoading.value = false;
    }
  }

  async function deleteGroupJoinJob(accountId: string, jobId: string) {
    actionLoading.value = true;
    try {
      await api.delete(`/zalo-accounts/${accountId}/group-join-jobs/${jobId}`);
      await fetchGroupJoinJobs(accountId);
      return true;
    } finally {
      actionLoading.value = false;
    }
  }

  return {
    members, memberStats, links, linkStats, discoveredLinks, discoveryStats, crawlGroups, crawlGroupStats, joinJobs, loading, actionLoading,
    fetchAudience, exportAudience, updateAudienceMember,
    fetchGroupLinks, importGroupLinks, checkGroupLink, joinGroupLink, updateGroupLink,
    fetchGroupLinkDiscoveries, crawlGroupLinkDiscoveries, fetchGroupLinkCrawlGroups,
    fetchGroupJoinJobs, createGroupJoinJob, updateGroupJoinJob, startGroupJoinJob, stopGroupJoinJob, deleteGroupJoinJob,
  };
}
