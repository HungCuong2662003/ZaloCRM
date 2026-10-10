<template>
  <div class="pa-4 d-flex flex-column gap-3">
    <div class="d-flex align-center gap-3 flex-wrap">
      <div>
        <div class="text-caption text-medium-emphasis">Marketing / Thành viên nhóm</div>
        <h1 class="text-h5">Thành viên đã quét</h1>
      </div>
      <v-spacer />
      <v-select
        v-model="selectedAccountId"
        :items="accounts"
        item-title="displayName"
        item-value="id"
        label="Nick Zalo"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 260px"
        @update:model-value="onAccountChange"
      />
      <v-btn prepend-icon="mdi-refresh" variant="outlined" :loading="loading" @click="reload">Tải lại</v-btn>
      <v-btn prepend-icon="mdi-file-export" color="primary" variant="outlined" @click="exportNow">Xuất Excel</v-btn>
    </div>

    <div class="stat-grid">
      <v-card v-for="item in statItems" :key="item.label" variant="tonal" class="pa-3">
        <div class="text-caption">{{ item.label }}</div>
        <div class="text-h6">{{ item.value ?? 0 }}</div>
      </v-card>
    </div>

    <v-card variant="outlined">
      <div class="d-flex align-center gap-3 pa-3 flex-wrap">
        <v-text-field v-model="filters.q" label="Tìm tên/UID" density="compact" variant="outlined" hide-details style="max-width: 260px" @keyup.enter="reload" />
        <v-select v-model="filters.groupId" :items="groupOptions" label="Nhóm nguồn" density="compact" variant="outlined" hide-details clearable style="max-width: 260px" />
        <v-select v-model="filters.isFriend" :items="friendOptions" label="Bạn bè" density="compact" variant="outlined" hide-details clearable style="max-width: 180px" />
        <v-select v-model="filters.contacted" :items="yesNoOptions" label="Đã nhắn" density="compact" variant="outlined" hide-details clearable style="max-width: 180px" />
        <v-select v-model="filters.invited" :items="yesNoOptions" label="Đã kết bạn" density="compact" variant="outlined" hide-details clearable style="max-width: 180px" />
        <v-select v-model="filters.suppressed" :items="yesNoOptions" label="Không liên hệ" density="compact" variant="outlined" hide-details clearable style="max-width: 180px" />
        <v-btn color="primary" variant="tonal" @click="reload">Lọc</v-btn>
      </div>
      <v-data-table
        v-model="selected"
        :headers="headers"
        :items="members"
        :loading="loading"
        item-value="memberUid"
        show-select
        density="comfortable"
      >
        <template #item.member="{ item }">
          <div class="d-flex align-center gap-2 py-1">
            <v-avatar :image="item.avatarUrl || undefined" size="34" color="primary" />
            <div>
              <div class="font-weight-medium">{{ item.displayName || item.zaloName || item.memberUid }}</div>
              <div class="text-caption text-medium-emphasis">{{ item.memberUid }}</div>
            </div>
          </div>
        </template>
        <template #item.sourceGroups="{ item }">
          <div class="source-groups">
            <v-chip v-for="gid in item.sourceGroups" :key="gid" size="x-small" variant="tonal">{{ groupName(gid) }}</v-chip>
          </div>
        </template>
        <template #item.isFriend="{ item }">
          <v-chip size="small" :color="item.isFriend ? 'success' : 'warning'" variant="tonal">{{ item.isFriend ? 'Đã là bạn' : 'Người lạ' }}</v-chip>
        </template>
        <template #item.status="{ item }">
          <div class="d-flex gap-1 flex-wrap">
            <v-chip size="x-small" variant="tonal">IB: {{ item.privateMessageStatus || 'chưa' }}</v-chip>
            <v-chip size="x-small" variant="tonal">KB: {{ item.friendInviteStatus || 'chưa' }}</v-chip>
            <v-chip v-if="item.suppressedAt" size="x-small" color="error" variant="tonal">không liên hệ</v-chip>
          </div>
        </template>
        <template #item.actions="{ item }">
          <div class="row-actions">
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-message-outline"
              @click="openMessageDialog(item)"
            >
              Nhắn
            </v-btn>
            <v-btn
              v-if="!item.isFriend"
              size="small"
              color="success"
              variant="tonal"
              prepend-icon="mdi-account-plus"
              :loading="invitingUid === item.memberUid"
              :disabled="Boolean(item.suppressedAt) || item.friendInviteStatus === 'sent'"
              @click="sendFriendInvite(item)"
            >
              {{ item.friendInviteStatus === 'sent' ? 'Đã gửi KB' : 'Kết bạn' }}
            </v-btn>
            <v-btn size="small" variant="text" @click="markMemberContacted(item)">Ghi đã nhắn</v-btn>
            <v-btn size="small" variant="text" @click="markMemberInvited(item)">Ghi đã gửi KB</v-btn>
            <v-btn size="small" variant="text" @click="toggleSuppressed(item)">
              {{ item.suppressedAt ? 'Bỏ chặn' : 'Không liên hệ' }}
            </v-btn>
          </div>
        </template>
      </v-data-table>
      <div class="d-flex align-center gap-2 pa-3 border-t">
        <span class="text-caption text-medium-emphasis">Đã chọn {{ selected.length }} thành viên</span>
        <v-spacer />
        <v-btn size="small" variant="outlined" :disabled="!selected.length" :loading="actionLoading" @click="markSelectedContacted">Ghi đã nhắn</v-btn>
        <v-btn size="small" variant="outlined" :disabled="!selected.length" :loading="actionLoading" @click="markSelectedInvited">Ghi đã gửi KB</v-btn>
        <v-btn size="small" variant="outlined" :disabled="!selected.length" :loading="actionLoading" @click="markSelectedSuppressed">Đưa vào không liên hệ</v-btn>
      </div>
    </v-card>

    <v-dialog v-model="messageDialog.show" max-width="520" persistent>
      <v-card>
        <v-card-title class="d-flex align-center gap-2">
          <v-icon icon="mdi-message-outline" size="20" />
          Nhắn tin riêng
        </v-card-title>
        <v-card-text class="d-flex flex-column gap-3">
          <div class="text-body-2">
            Tới: <strong>{{ messageDialog.member ? memberName(messageDialog.member) : '' }}</strong>
            <span class="text-medium-emphasis"> · {{ selectedAccountName }}</span>
          </div>
          <v-textarea
            v-model="messageDialog.content"
            label="Nội dung"
            rows="5"
            auto-grow
            variant="outlined"
            hide-details="auto"
            autofocus
          />
          <QuickMessageSelect v-model="messageDialog.content" />
          <div class="d-flex align-center gap-2 flex-wrap">
            <input
              ref="imageInput"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              hidden
              @change="onImageInput"
            />
            <v-btn
              variant="outlined"
              prepend-icon="mdi-image-plus"
              :disabled="messageDialog.sending"
              @click="imageInput?.click()"
            >
              Chọn ảnh
            </v-btn>
            <span class="text-caption text-medium-emphasis">Ảnh sẽ gửi kèm nội dung bên trên.</span>
          </div>
          <div v-if="messageDialog.imagePreviews.length" class="image-previews">
            <div v-for="(src, index) in messageDialog.imagePreviews" :key="src" class="image-preview">
              <v-img :src="src" cover />
              <v-btn
                icon="mdi-close"
                size="x-small"
                color="error"
                variant="elevated"
                class="image-remove"
                title="Bỏ ảnh"
                :disabled="messageDialog.sending"
                @click="removeImage(index)"
              />
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="messageDialog.sending" @click="closeMessageDialog">Hủy</v-btn>
          <v-btn color="primary" :loading="messageDialog.sending" :disabled="!canSendMessage" @click="sendMemberMessage">
            Gửi tin
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/index';
import { useSelectedAccount } from '@/composables/use-selected-account';
import { useGroups } from '@/composables/use-groups';
import { useGroupAudience } from '@/composables/use-group-audience';
import { useToast } from '@/composables/use-toast';
import QuickMessageSelect from '@/components/chat/QuickMessageSelect.vue';

const { accounts, selectedAccountId, selectAccount } = useSelectedAccount();
const { groups, fetchGroups } = useGroups();
const { members, memberStats, loading, actionLoading, fetchAudience, exportAudience, updateAudienceMember } = useGroupAudience();
const route = useRoute();
const toast = useToast();

const selected = ref<string[]>([]);
const invitingUid = ref<string | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const filters = reactive({ q: '', groupId: '', isFriend: null as boolean | null, contacted: null as boolean | null, invited: null as boolean | null, suppressed: null as boolean | null });
const friendRequestMessage = 'Xin chào, tôi muốn kết bạn với bạn.';
const messageDialog = reactive({
  show: false,
  member: null as any | null,
  content: '',
  files: [] as File[],
  imagePreviews: [] as string[],
  sending: false,
});

const headers = [
  { title: 'Thành viên', key: 'member', sortable: false },
  { title: 'Nhóm nguồn', key: 'sourceGroups', sortable: false },
  { title: 'Bạn bè', key: 'isFriend' },
  { title: 'Trạng thái xử lý', key: 'status', sortable: false },
  { title: 'Lần quét', key: 'lastSeenAt' },
  { title: '', key: 'actions', sortable: false },
];
const friendOptions = [{ title: 'Đã là bạn', value: true }, { title: 'Người lạ', value: false }];
const yesNoOptions = [{ title: 'Có', value: true }, { title: 'Không', value: false }];
const groupOptions = computed(() => groups.value.map((g: any) => ({ title: g.name || g.groupName || g.id, value: g.id })));
const statItems = computed(() => [
  { label: 'Tổng', value: memberStats.value.total },
  { label: 'Người lạ', value: memberStats.value.strangers },
  { label: 'Đã nhắn', value: memberStats.value.contacted },
  { label: 'Nhắn lỗi', value: memberStats.value.contactFailed },
  { label: 'Đã gửi KB', value: memberStats.value.invited },
  { label: 'Không liên hệ', value: memberStats.value.suppressed },
]);
const selectedAccountName = computed(() => accounts.value.find((account: any) => account.id === selectedAccountId.value)?.displayName || 'Nick đang chọn');
const canSendMessage = computed(() => Boolean(messageDialog.content.trim() || messageDialog.files.length));

function params() {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined));
}
function groupName(groupId: string) {
  return groups.value.find((g: any) => g.id === groupId)?.name || groupId;
}
function memberName(item: any) {
  return item.displayName || item.zaloName || item.memberUid;
}
async function reload() {
  if (!selectedAccountId.value) return;
  await fetchAudience(selectedAccountId.value, params());
}
function exportNow() {
  if (selectedAccountId.value) exportAudience(selectedAccountId.value, params());
}
async function toggleSuppressed(item: any) {
  await updateAudienceMember(selectedAccountId.value, item.memberUid, { suppressed: !item.suppressedAt });
  await reload();
}

function openMessageDialog(item: any) {
  messageDialog.member = item;
  messageDialog.content = '';
  clearMessageImages();
  messageDialog.show = true;
}

function clearMessageImages() {
  for (const url of messageDialog.imagePreviews) URL.revokeObjectURL(url);
  messageDialog.files = [];
  messageDialog.imagePreviews = [];
  if (imageInput.value) imageInput.value.value = '';
}

function onImageInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/'));
  clearMessageImages();
  messageDialog.files = files;
  messageDialog.imagePreviews = files.map((file) => URL.createObjectURL(file));
}

function removeImage(index: number) {
  const [preview] = messageDialog.imagePreviews.splice(index, 1);
  if (preview) URL.revokeObjectURL(preview);
  messageDialog.files.splice(index, 1);
}

function closeMessageDialog() {
  if (messageDialog.sending) return;
  messageDialog.show = false;
  messageDialog.member = null;
  messageDialog.content = '';
  clearMessageImages();
}

async function sendMemberMessage() {
  if (!selectedAccountId.value || !messageDialog.member || !canSendMessage.value) return;
  const item = messageDialog.member;
  messageDialog.sending = true;
  try {
    const res = await api.post<{ conversationId: string }>(
      '/conversations/ensure-by-uid',
      {
        zaloAccountId: selectedAccountId.value,
        uid: item.memberUid,
        commit: true,
        contactMode: 'create',
        zaloName: memberName(item),
        zaloAvatarUrl: item.avatarUrl || null,
        zaloGlobalId: item.globalId || null,
      },
    );
    let sent: any;
    if (messageDialog.files.length) {
      const formData = new FormData();
      for (const file of messageDialog.files) formData.append('files', file, file.name);
      if (messageDialog.content.trim()) formData.append('caption', messageDialog.content.trim());
      sent = await api.post(`/conversations/${res.data.conversationId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } else {
      sent = await api.post(`/conversations/${res.data.conversationId}/messages`, { content: messageDialog.content.trim() });
    }
    const failed = sent.data?.metadata?.sendStatus === 'failed';
    await updateAudienceMember(selectedAccountId.value, item.memberUid, {
      privateMessageStatus: failed ? 'failed' : 'sent',
      privateMessageLastAt: new Date().toISOString(),
      lastFailureReason: failed ? sent.data?.metadata?.failReason || 'Zalo từ chối gửi tin' : null,
    });
    if (failed) toast.error(sent.data?.metadata?.failReason || 'Zalo từ chối gửi tin', 5000);
    else toast.success('Đã gửi tin nhắn');
    messageDialog.sending = false;
    closeMessageDialog();
    await reload();
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Không gửi được tin nhắn', 5000);
  } finally {
    messageDialog.sending = false;
  }
}
async function sendFriendInvite(item: any) {
  if (!selectedAccountId.value) return;
  invitingUid.value = item.memberUid;
  try {
    const statusRes = await api.get(`/zalo-accounts/${selectedAccountId.value}/friends/requests/${item.memberUid}/status`);
    const status = statusRes.data?.data ?? statusRes.data;
    if (status?.is_friend === 1) {
      await updateAudienceMember(selectedAccountId.value, item.memberUid, {
        friendInviteStatus: 'accepted',
        friendInviteLastAt: new Date().toISOString(),
        lastFailureReason: null,
      });
      toast.success('Nick này đã là bạn bè');
      await reload();
      return;
    }
    if (status?.is_requested === 1) {
      await updateAudienceMember(selectedAccountId.value, item.memberUid, {
        friendInviteStatus: 'sent',
        friendInviteLastAt: new Date().toISOString(),
        lastFailureReason: null,
      });
      toast.warning('Đã gửi lời mời trước đó');
      await reload();
      return;
    }
    await api.post(`/zalo-accounts/${selectedAccountId.value}/friends/requests`, {
      userId: item.memberUid,
      message: friendRequestMessage,
    });
    await updateAudienceMember(selectedAccountId.value, item.memberUid, {
      friendInviteStatus: 'sent',
      friendInviteLastAt: new Date().toISOString(),
      lastFailureReason: null,
    });
    toast.success('Đã gửi lời mời kết bạn');
    await reload();
  } catch (err: any) {
    const message = err?.response?.data?.error || 'Không gửi được lời mời kết bạn';
    if (err?.response?.status === 429 || err?.response?.data?.code === 'RATE_LIMITED') {
      toast.warning(`${message}. Chờ rồi gửi tiếp, không ghi lỗi vào thành viên.`, 6000);
    } else {
      await updateAudienceMember(selectedAccountId.value, item.memberUid, {
        friendInviteStatus: 'failed',
        friendInviteLastAt: new Date().toISOString(),
        lastFailureReason: message,
      });
      toast.error(message, 5000);
    }
  } finally {
    invitingUid.value = null;
  }
}
async function markMemberContacted(item: any) {
  await updateAudienceMember(selectedAccountId.value, item.memberUid, { privateMessageStatus: 'sent', privateMessageLastAt: new Date().toISOString() });
  await reload();
}
async function markMemberInvited(item: any) {
  await updateAudienceMember(selectedAccountId.value, item.memberUid, { friendInviteStatus: 'sent', friendInviteLastAt: new Date().toISOString() });
  await reload();
}
async function markSelectedContacted() {
  const now = new Date().toISOString();
  for (const uid of selected.value) await updateAudienceMember(selectedAccountId.value, uid, { privateMessageStatus: 'sent', privateMessageLastAt: now });
  selected.value = [];
  await reload();
}
async function markSelectedInvited() {
  const now = new Date().toISOString();
  for (const uid of selected.value) await updateAudienceMember(selectedAccountId.value, uid, { friendInviteStatus: 'sent', friendInviteLastAt: now });
  selected.value = [];
  await reload();
}
async function markSelectedSuppressed() {
  for (const uid of selected.value) await updateAudienceMember(selectedAccountId.value, uid, { suppressed: true });
  selected.value = [];
  await reload();
}
async function onAccountChange(id: string) {
  selectAccount(id);
  selected.value = [];
  await fetchGroups(id);
  await reload();
}
onMounted(async () => {
  const accountId = typeof route.query.accountId === 'string' ? route.query.accountId : '';
  if (accountId) selectAccount(accountId);
  if (route.query.isFriend === 'true') filters.isFriend = true;
  if (route.query.isFriend === 'false') filters.isFriend = false;
  if (selectedAccountId.value) {
    await fetchGroups(selectedAccountId.value);
    await reload();
  }
});

onBeforeUnmount(clearMessageImages);
</script>

<style scoped>
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.source-groups { display: flex; flex-wrap: wrap; gap: 4px; max-width: 420px; }
.row-actions { display: flex; flex-wrap: wrap; gap: 4px; min-width: 360px; }
.border-t { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.image-previews { display: flex; flex-wrap: wrap; gap: 8px; }
.image-preview { position: relative; width: 84px; height: 84px; overflow: hidden; border-radius: 6px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.image-preview .v-img { width: 100%; height: 100%; }
.image-remove { position: absolute; top: 3px; right: 3px; }
</style>
