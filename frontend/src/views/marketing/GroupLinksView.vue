<template>
  <div class="pa-4 d-flex flex-column gap-3 group-links-page">
    <div class="d-flex align-center gap-3 flex-wrap">
      <div>
        <div class="text-caption text-medium-emphasis">Marketing / Link nhóm</div>
        <h1 class="text-h5">Quản lý link nhóm Zalo</h1>
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
    </div>

    <div class="stat-grid">
      <v-card v-for="item in statItems" :key="item.label" variant="tonal" class="pa-3">
        <div class="text-caption">{{ item.label }}</div>
        <div class="text-h6">{{ item.value ?? 0 }}</div>
      </v-card>
    </div>

    <v-card variant="outlined">
      <v-card-title class="d-flex align-center gap-2">
        <v-icon icon="mdi-login-variant" size="20" />
        Tham gia nhóm từ link
      </v-card-title>
      <v-card-text class="d-flex flex-column gap-3">
        <v-textarea
          v-model="importText"
          label="Paste danh sách link nhóm, mỗi dòng 1 link"
          rows="4"
          variant="outlined"
          hide-details
        />
        <div class="d-flex align-center gap-3 flex-wrap">
          <v-file-input
            v-model="importFiles"
            accept=".txt,.csv,.xlsx"
            label="Import TXT/CSV/XLSX"
            variant="outlined"
            density="compact"
            prepend-icon="mdi-file-upload"
            show-size
            hide-details
            style="max-width: 320px"
            @update:model-value="readFiles"
          />
          <v-text-field
            v-model.number="checkDelayMs"
            type="number"
            min="0"
            max="5000"
            step="100"
            label="Delay check (ms)"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 170px"
          />
          <v-chip variant="tonal">{{ importLinkCount }} link</v-chip>
          <v-spacer />
          <v-btn prepend-icon="mdi-clipboard-text-outline" variant="outlined" @click="pasteClipboard">Paste</v-btn>
          <v-btn prepend-icon="mdi-file-excel" color="success" variant="outlined" :disabled="!links.length" @click="exportExcel()">Xuất Excel tất cả</v-btn>
          <v-btn v-if="checking" prepend-icon="mdi-stop" color="error" variant="tonal" @click="stopRequested = true">Dừng tra cứu</v-btn>
          <v-btn prepend-icon="mdi-magnify" color="primary" :loading="checking" :disabled="!canScan" @click="scanPastedLinks">Lưu + kiểm tra link</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="outlined">
      <v-card-title class="d-flex align-center gap-2 flex-wrap">
        <v-icon icon="mdi-calendar-clock-outline" size="20" />
        Auto tham gia nhóm
        <v-chip size="small" variant="tonal">{{ joinJobs.length }} job</v-chip>
        <v-spacer />
        <v-btn prepend-icon="mdi-refresh" size="small" variant="outlined" :loading="loading" @click="loadJoinJobs">Làm mới job</v-btn>
      </v-card-title>
      <v-card-text class="d-flex flex-column gap-3">
        <div class="text-caption text-medium-emphasis">
          Mỗi job chạy riêng theo nick, lấy link theo tiêu chí đã chọn. Đủ hạn mức ngày thì tự chờ sang ngày sau.
        </div>
        <div class="d-flex align-center gap-2 flex-wrap">
          <v-chip variant="tonal">Đã chọn {{ selected.length }} link</v-chip>
          <v-spacer />
          <v-btn prepend-icon="mdi-playlist-check" color="primary" variant="outlined" :disabled="!selected.length" @click="openJoinJobDialog('selected')">
            Tạo từ link đã chọn
          </v-btn>
          <v-btn prepend-icon="mdi-select-all" color="primary" variant="tonal" @click="openJoinJobDialog('all')">
            Tạo từ tất cả link hợp lệ
          </v-btn>
        </div>
        <div v-if="!joinJobs.length" class="text-caption text-medium-emphasis">Chưa có job auto join.</div>
        <div v-for="job in joinJobs" :key="job.id" class="join-job-row">
          <div class="d-flex align-center gap-2 flex-wrap">
            <v-chip size="small" :color="joinJobStateColor(job.state)" variant="tonal">{{ joinJobStateText(job.state) }}</v-chip>
            <span class="font-weight-medium">{{ accountName(job.zaloAccountId) }}</span>
            <span class="text-caption text-medium-emphasis">{{ job.linkIds?.length ?? 0 }} link · tối đa {{ job.maxPerDay }}/ngày · {{ joinJobDelayLabel(job) }}</span>
            <v-spacer />
            <v-btn v-if="['queued', 'running', 'waiting'].includes(job.state)" size="small" color="warning" variant="outlined" :loading="actionLoading" @click="stopJoinJob(job.id)">Dừng</v-btn>
            <v-btn v-else size="small" color="primary" variant="outlined" :loading="actionLoading" @click="startJoinJob(job.id)">Start</v-btn>
            <v-btn size="small" variant="text" icon="mdi-pencil" :disabled="['queued', 'running'].includes(job.state)" @click="editJoinJob(job)" />
            <v-btn size="small" variant="text" color="error" icon="mdi-delete-outline" :loading="actionLoading" @click="deleteJoinJob(job.id)" />
          </div>
          <div class="text-caption text-medium-emphasis">
            Đã join {{ job.joined ?? 0 }} · bỏ qua {{ job.skipped ?? 0 }} · lỗi {{ job.failed ?? 0 }}
            <span v-if="job.nextRunAt"> · chạy lại {{ formatTime(job.nextRunAt) }}</span>
            <span v-if="job.lastError" class="text-error"> · {{ job.lastError }}</span>
          </div>
          <div v-if="job.logs?.length" class="join-job-log text-caption">
            <div v-for="log in job.logs.slice(0, 5)" :key="log.id">
              {{ formatTime(log.createdAt) }} · {{ joinJobLogText(log.state) }} · {{ shortId(log.linkId) }}
              <span v-if="log.error" class="text-error"> · {{ log.error }}</span>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="joinJobDialog" max-width="560">
      <v-card>
        <v-card-title>{{ editingJoinJobId ? 'Sửa job auto join' : 'Tạo job auto join' }}</v-card-title>
        <v-card-text class="d-flex flex-column gap-3">
          <v-select
            v-model="joinJobScope"
            :items="joinJobScopeOptions"
            item-title="title"
            item-value="value"
            label="Nguồn link"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="Boolean(editingJoinJobId)"
          />
          <div class="d-flex gap-2 flex-wrap">
            <v-select
              v-model="joinJobLinkStatus"
              :items="linkStatusOptions"
              item-title="title"
              item-value="value"
              label="Tình trạng link"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-select
              v-model="joinJobCanSendMessage"
              :items="yesNoUnknownOptions"
              item-title="title"
              item-value="value"
              label="Nhắn tin"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <v-select
              v-model="joinJobCanViewMembers"
              :items="yesNoUnknownOptions"
              item-title="title"
              item-value="value"
              label="Xem TV"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-select
              v-model="joinJobMembershipStatus"
              :items="membershipOptions"
              item-title="title"
              item-value="value"
              label="Nick này"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <v-text-field v-model.number="joinJobMaxPerDay" type="number" min="1" max="500" label="Số nhóm tối đa mỗi ngày" variant="outlined" hide-details />
          <div class="d-flex gap-2">
            <v-text-field v-model.number="joinJobDelayMinSeconds" type="number" min="10" label="Delay thấp nhất (giây)" variant="outlined" hide-details />
            <v-text-field v-model.number="joinJobDelayMaxSeconds" type="number" min="10" label="Delay cao nhất (giây)" variant="outlined" hide-details />
          </div>
          <v-text-field v-model="joinJobStopAt" type="datetime-local" label="Dừng lúc (không bắt buộc)" variant="outlined" hide-details />
          <v-switch v-model="joinJobAutoStart" label="Lưu xong chạy luôn" color="primary" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="joinJobDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="actionLoading" @click="saveJoinJob">Lưu job</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-card variant="outlined" class="table-card">
      <v-card-title class="d-flex align-center gap-2 flex-wrap">
        <v-icon icon="mdi-message-search-outline" size="20" />
        Quét link từ tin nhắn đã lưu
        <v-spacer />
        <v-chip size="small" color="primary" variant="tonal">
          Hôm nay {{ discoveryStats.todayJoins ?? 0 }} join
        </v-chip>
      </v-card-title>
      <v-card-text class="d-flex flex-column gap-3">
        <div class="d-flex align-center gap-3 flex-wrap">
          <v-select
            v-model="discoveryScope"
            :items="discoveryScopeOptions"
            item-title="title"
            item-value="value"
            label="Phạm vi quét"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 220px"
          />
          <v-select
            v-model="discoveryPlatform"
            :items="discoveryPlatformOptions"
            item-title="title"
            item-value="value"
            label="Nền tảng"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 170px"
            @update:model-value="loadDiscoveries"
          />
          <v-text-field
            v-model.number="discoveryDays"
            type="number"
            min="1"
            max="3650"
            label="Số ngày"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 130px"
          />
          <v-text-field
            v-model.number="discoveryLimit"
            type="number"
            min="1"
            max="50000"
            step="500"
            label="Số tin quét"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 150px"
          />
          <v-switch
            v-model="discoveryAutoCheck"
            label="Check Zalo sau khi quét"
            color="primary"
            density="compact"
            hide-details
          />
          <v-spacer />
          <v-btn prepend-icon="mdi-refresh" variant="outlined" :loading="loading" @click="loadDiscoveries">Làm mới</v-btn>
          <v-btn prepend-icon="mdi-link-variant" variant="outlined" :disabled="!discoveryRows.length" @click="scrollToDiscoveries">Xem link đã quét</v-btn>
          <v-btn
            prepend-icon="mdi-radar"
            color="primary"
            :loading="crawlingDiscoveries"
            :disabled="!canCrawlDiscoveries || crawlingDiscoveries"
            @click="crawlDiscoveries()"
          >
            Quét tin nhắn
          </v-btn>
        </div>

        <div class="d-flex align-center gap-2 flex-wrap">
          <v-chip variant="tonal">Nhóm: {{ crawlGroupStats.totalGroups ?? 0 }}</v-chip>
          <v-chip variant="tonal" color="success">Đã quét: {{ crawlGroupStats.crawledGroups ?? 0 }}</v-chip>
          <v-chip variant="tonal" color="warning">Chưa quét: {{ crawlGroupStats.uncrawledGroups ?? 0 }}</v-chip>
          <v-spacer />
          <v-btn size="small" variant="outlined" :loading="crawlingDiscoveries" :disabled="!selectedCrawlGroups.length || crawlingDiscoveries" @click="crawlSelectedGroups">Quét nhóm đã chọn</v-btn>
          <v-btn size="small" color="primary" variant="tonal" :loading="crawlingDiscoveries" :disabled="!crawlGroupRows.length || crawlingDiscoveries" @click="crawlAllGroups">Quét tất cả nhóm hiển thị</v-btn>
        </div>

        <v-alert v-if="crawlResult.message" :type="crawlResult.type" variant="tonal" density="compact" role="status">
          {{ crawlResult.message }}
        </v-alert>

        <v-data-table
          v-model="selectedCrawlGroups"
          :headers="crawlGroupHeaders"
          :items="crawlGroupRows"
          :loading="loading"
          item-value="conversationId"
          show-select
          density="compact"
          :items-per-page="5"
          :items-per-page-options="[5, 8, 20, 50]"
          items-per-page-text="Dòng/trang"
          class="crawl-group-table"
        >
          <template #item.group="{ item }">
            <div class="py-1">
              <div class="font-weight-medium">{{ item.groupName || item.sourceThreadName || item.externalThreadId || item.sourceThreadId || item.conversationId }}</div>
              <div class="text-caption text-medium-emphasis">{{ item.externalThreadId || item.sourceThreadId }}</div>
            </div>
          </template>
          <template #item.account="{ item }">
            <span>{{ accountName(item.zaloAccountId) }}</span>
          </template>
          <template #item.lastCrawledAt="{ item }">
            <span class="text-caption">{{ formatTime(item.lastCrawledAt) || 'Chưa quét' }}</span>
          </template>
        </v-data-table>

        <div ref="discoveriesEl" class="result-head">
          <div class="d-flex align-center gap-2">
            <v-icon icon="mdi-link-variant" size="20" />
            <div class="font-weight-medium">Link đã quét từ tin nhắn</div>
          </div>
          <v-chip size="small" color="primary" variant="tonal">{{ discoveryRows.length }} link đang hiển thị</v-chip>
        </div>

        <div class="stat-grid">
          <v-card v-for="item in discoveryStatItems" :key="item.label" variant="tonal" class="pa-3">
            <div class="text-caption">{{ item.label }}</div>
            <div class="text-h6">{{ item.value ?? 0 }}</div>
          </v-card>
        </div>

        <v-data-table
          :headers="discoveryHeaders"
          :items="discoveryRows"
          :loading="loading"
          item-value="id"
          density="comfortable"
          :items-per-page="10"
          :items-per-page-options="[10, 20, 50]"
          items-per-page-text="Dòng/trang"
          class="discovery-table"
        >
          <template #item.account="{ item }">
            <span>{{ accountName(item.zaloAccountId) }}</span>
          </template>
          <template #item.link="{ item }">
            <div class="py-1">
              <div class="font-weight-medium">{{ item.title || item.normalizedUrl }}</div>
              <div class="text-caption text-medium-emphasis d-flex align-center gap-1">
                <v-chip size="x-small" :color="platformColor(item.platform)" variant="tonal">{{ platformText(item.platform) }}</v-chip>
                <span class="text-truncate">{{ item.normalizedUrl }}</span>
                <v-btn icon="mdi-open-in-new" size="x-small" variant="text" :href="item.normalizedUrl" target="_blank" />
              </div>
            </div>
          </template>
          <template #item.source="{ item }">
            <div class="text-caption">
              <div>{{ item.sourceThreadName || item.sourceThreadId || '-' }}</div>
              <div class="text-medium-emphasis text-truncate">{{ item.sourceSnippet }}</div>
            </div>
          </template>
          <template #item.checkStatus="{ item }">
            <v-chip size="small" :color="linkColor(item.checkStatus)" variant="tonal">{{ linkText(item.checkStatus) }}</v-chip>
          </template>
          <template #item.canSendMessage="{ item }">
            <v-chip size="small" :color="boolColor(item.canSendMessage)" variant="tonal">{{ boolText(item.canSendMessage) }}</v-chip>
          </template>
          <template #item.messageSentAt="{ item }">
            <span class="text-caption">{{ formatTime(item.messageSentAt) }}</span>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              size="small"
              color="success"
              :disabled="!canJoinDiscovered(item)"
              :loading="joiningId === `discovery:${item.id}`"
              @click="joinDiscovered(item)"
            >
              Tham gia
            </v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <v-card variant="outlined" class="table-card">
      <div class="d-flex align-center gap-3 pa-3 flex-wrap">
        <v-text-field
          v-model="filters.q"
          label="Tìm link/tên nhóm"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 260px"
          @keyup.enter="reload"
        />
        <v-select
          v-model="filters.linkStatus"
          :items="linkStatusOptions"
          item-title="title"
          item-value="value"
          label="Tình trạng link"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 190px"
        />
        <v-select
          v-model="filters.joinStatus"
          :items="joinStatusOptions"
          item-title="title"
          item-value="value"
          label="Join"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 180px"
        />
        <v-select
          v-model="filters.canViewMembers"
          :items="yesNoUnknownOptions"
          item-title="title"
          item-value="value"
          label="Xem TV"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 160px"
        />
        <v-select
          v-model="filters.canSendMessage"
          :items="yesNoUnknownOptions"
          item-title="title"
          item-value="value"
          label="Nhắn tin"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 160px"
        />
        <v-select
          v-model="filters.membershipStatus"
          :items="membershipOptions"
          item-title="title"
          item-value="value"
          label="Nick này"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 190px"
        />
        <v-btn color="primary" variant="tonal" @click="reload">Lọc</v-btn>
        <v-spacer />
        <v-btn
          prepend-icon="mdi-magnify-scan"
          variant="outlined"
          :loading="checking"
          :disabled="!tableLinks.length || checking"
          @click="checkVisible"
        >
          {{ checking ? `Đang kiểm tra ${checkProgress.done}/${checkProgress.total}` : 'Kiểm tra tất cả đang lọc' }}
        </v-btn>
        <v-btn
          prepend-icon="mdi-check-all"
          variant="outlined"
          :loading="checking"
          :disabled="!selected.length || checking"
          @click="checkSelected"
        >
          Kiểm tra đã chọn
        </v-btn>
        <v-btn prepend-icon="mdi-select-all" variant="outlined" :disabled="!tableLinks.length || joiningSelected" @click="selectAllLinks">Chọn tất cả link đang lọc</v-btn>
        <v-btn prepend-icon="mdi-close-box-multiple-outline" variant="text" :disabled="!selected.length || joiningSelected" @click="clearSelectedLinks">Bỏ chọn tất cả</v-btn>
      </div>
      <div v-if="checkProgress.total" class="link-check-progress px-3 pb-3">
        <div class="d-flex align-center text-caption text-medium-emphasis">
          <span>{{ checkSummary }}</span>
          <v-spacer />
          <span>{{ checkProgress.done }}/{{ checkProgress.total }}</span>
        </div>
        <v-progress-linear :model-value="checkPercent" height="6" rounded color="primary" />
        <div v-if="checking && checkProgress.current" class="text-caption text-medium-emphasis text-truncate mt-1">
          Đang kiểm tra: {{ checkProgress.current }}
        </div>
      </div>

      <v-data-table
        v-model="selected"
        :headers="headers"
        :items="tableLinks"
        :loading="loading"
        item-value="id"
        show-select
        select-strategy="all"
        density="comfortable"
        :items-per-page="10"
        :items-per-page-options="[10, 20, 50]"
        items-per-page-text="Dòng/trang"
        class="link-table"
      >
        <template #item.group="{ item }">
          <div class="py-1">
            <div class="font-weight-medium">{{ item.groupName || item.normalizedLink }}</div>
            <div class="text-caption text-medium-emphasis d-flex align-center gap-1">
              <span class="text-truncate">{{ item.normalizedLink }}</span>
              <v-btn icon="mdi-open-in-new" size="x-small" variant="text" :href="item.normalizedLink" target="_blank" />
            </div>
            <div v-if="item.groupId" class="text-caption text-medium-emphasis">ID: {{ item.groupId }}</div>
          </div>
        </template>
        <template #item.memberCount="{ item }">
          <span>{{ item.memberCount ?? '-' }}</span>
        </template>
        <template #item.canViewMembers="{ item }">
          <v-chip size="small" :color="boolColor(item.canViewMembers)" variant="tonal">{{ boolText(item.canViewMembers) }}</v-chip>
        </template>
        <template #item.canSendMessage="{ item }">
          <v-chip size="small" :color="boolColor(item.canSendMessage)" variant="tonal">{{ boolText(item.canSendMessage) }}</v-chip>
        </template>
        <template #item.accountMembershipStatus="{ item }">
          <v-chip size="small" :color="membershipColor(item.accountMembershipStatus)" variant="tonal">{{ membershipText(item.accountMembershipStatus) }}</v-chip>
        </template>
        <template #item.linkStatus="{ item }">
          <v-chip size="small" :color="linkColor(item.linkStatus)" variant="tonal">{{ linkText(item.linkStatus) }}</v-chip>
        </template>
        <template #item.joinStatus="{ item }">
          <v-chip size="small" :color="joinColor(item.joinStatus)" variant="tonal">{{ joinText(item.joinStatus) }}</v-chip>
        </template>
        <template #item.lastCheckedAt="{ item }">
          <span class="text-caption">{{ formatTime(item.lastCheckedAt) }}</span>
        </template>
        <template #item.actions="{ item }">
          <div class="d-flex gap-2">
            <v-btn size="small" variant="outlined" :loading="checkingId === item.id" :disabled="checking" @click="checkOne(item)">Kiểm tra</v-btn>
            <v-btn size="small" color="success" :disabled="joinDisabled(item)" :loading="joiningId === item.id" @click="joinOne(item)">Tham gia</v-btn>
          </div>
        </template>
        <template #item.lastError="{ item }">
          <span class="text-caption text-error">{{ item.lastError || '' }}</span>
        </template>
      </v-data-table>

      <div class="d-flex align-center gap-2 pa-3 border-t flex-wrap">
        <span class="text-caption text-medium-emphasis">
          Đã chọn {{ selected.length }} link · có thể tham gia {{ selectedJoinableRows.length }}
        </span>
        <v-text-field
          v-model.number="manualJoinDelayMinSeconds"
          type="number"
          min="10"
          max="60"
          step="1"
          label="Delay join từ (giây)"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 155px"
        />
        <v-text-field
          v-model.number="manualJoinDelayMaxSeconds"
          type="number"
          min="10"
          max="60"
          step="1"
          label="đến (giây)"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 125px"
        />
        <span v-if="joiningSelected" class="text-caption text-medium-emphasis">
          Đang xử lý {{ joinProgress.done }}/{{ joinProgress.total }}
          <span v-if="joinProgress.current"> · {{ joinProgress.current }}</span>
        </span>
        <v-spacer />
        <v-btn
          size="small"
          color="success"
          variant="tonal"
          prepend-icon="mdi-login-variant"
          :disabled="!selectedJoinableRows.length || joiningSelected || checking"
          :loading="joiningSelected"
          @click="joinSelected"
        >
          Tham gia tất cả link đã chọn
        </v-btn>
        <v-btn
          size="small"
          color="success"
          variant="outlined"
          prepend-icon="mdi-file-excel"
          :disabled="!selected.length || joiningSelected"
          @click="exportExcel(true)"
        >
          Xuất Excel đã chọn
        </v-btn>
        <v-btn size="small" variant="outlined" :disabled="!selected.length || joiningSelected" @click="selected = []">Bỏ chọn</v-btn>
      </div>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3500">
      {{ snack.message }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { useSelectedAccount } from '@/composables/use-selected-account';
import { useGroupAudience } from '@/composables/use-group-audience';

type GroupLink = Record<string, any>;
type ImportStats = {
  total: number;
  invalid: number;
  duplicate: number;
  saved: number;
  existing: number;
  batchLinkIds?: string[];
};

const { accounts, selectedAccountId, selectAccount } = useSelectedAccount();
const {
  links,
  linkStats,
  discoveredLinks,
  discoveryStats,
  crawlGroups,
  crawlGroupStats,
  joinJobs,
  loading,
  actionLoading,
  fetchGroupLinks,
  importGroupLinks,
  checkGroupLink,
  joinGroupLink,
  fetchGroupLinkDiscoveries,
  crawlGroupLinkDiscoveries,
  fetchGroupLinkCrawlGroups,
  fetchGroupJoinJobs,
  createGroupJoinJob,
  updateGroupJoinJob,
  startGroupJoinJob,
  stopGroupJoinJob,
  deleteGroupJoinJob,
} = useGroupAudience();

const selected = ref<string[]>([]);
const selectedCrawlGroups = ref<string[]>([]);
const importText = ref('');
const importFiles = ref<File | File[] | null>(null);
const checkDelayMs = ref(3000);
const discoveryScope = ref<'current' | 'all'>('current');
const discoveryPlatform = ref<'all' | 'zalo' | 'telegram' | 'facebook' | 'web'>('all');
const discoveryDays = ref(30);
const discoveryLimit = ref(5000);
const discoveryAutoCheck = ref(true);
const joinJobDialog = ref(false);
const joinJobScope = ref<'selected' | 'all'>('selected');
const joinJobMaxPerDay = ref(20);
const joinJobDelayMinSeconds = ref(30);
const joinJobDelayMaxSeconds = ref(90);
const joinJobStopAt = ref('');
const joinJobAutoStart = ref(true);
const joinJobLinkStatus = ref('valid');
const joinJobCanSendMessage = ref('');
const joinJobCanViewMembers = ref('');
const joinJobMembershipStatus = ref('');
const editingJoinJobId = ref('');
const manualJoinDelayMinSeconds = ref(10);
const manualJoinDelayMaxSeconds = ref(15);
const checking = ref(false);
const checkingId = ref('');
const joiningIdByAccount = reactive<Record<string, string>>({});
const joiningSelectedByAccount = reactive<Record<string, boolean>>({});
type JoinProgress = { total: number; done: number; current: string };
const emptyJoinProgress = reactive<JoinProgress>({ total: 0, done: 0, current: '' });
const joinProgressByAccount = reactive<Record<string, JoinProgress>>({});
const joiningId = computed(() => joiningIdByAccount[selectedAccountId.value] || '');
const joiningSelected = computed(() => Boolean(joiningSelectedByAccount[selectedAccountId.value]));
const stopRequested = ref(false);
const crawlingDiscoveries = ref(false);
const crawlResult = reactive<{ message: string; type: 'info' | 'success' | 'warning' | 'error' }>({ message: '', type: 'info' });
const discoveriesEl = ref<HTMLElement | null>(null);
const checkProgress = reactive({ total: 0, done: 0, alive: 0, dead: 0, failed: 0, current: '' });
const joinProgress = computed(() => joinProgressByAccount[selectedAccountId.value] ?? emptyJoinProgress);
const filters = reactive({ q: '', linkStatus: '', joinStatus: '', canViewMembers: '', canSendMessage: '', membershipStatus: '' });
const snack = reactive({ show: false, message: '', color: 'success' });

const headers = [
  { title: '#', key: 'rowNumber', width: 64 },
  { title: 'Tên nhóm / Link', key: 'group', sortable: false },
  { title: 'TV', key: 'memberCount', width: 90 },
  { title: 'Xem TV', key: 'canViewMembers', width: 120 },
  { title: 'Nhắn tin', key: 'canSendMessage', width: 120 },
  { title: 'Nick này', key: 'accountMembershipStatus', width: 150 },
  { title: 'Link', key: 'linkStatus', width: 130 },
  { title: 'Join', key: 'joinStatus', width: 150 },
  { title: 'Lần kiểm tra', key: 'lastCheckedAt', width: 150 },
  { title: 'Lỗi', key: 'lastError', sortable: false },
  { title: '', key: 'actions', sortable: false, width: 180 },
];

const crawlGroupHeaders = [
  { title: 'Nhóm nguồn', key: 'group', sortable: false },
  { title: 'Nick', key: 'account', width: 170, sortable: false },
  { title: 'TV', key: 'groupMembersCount', width: 90 },
  { title: 'Tin đã quét', key: 'scannedMessages', width: 120 },
  { title: 'Link thấy', key: 'foundLinks', width: 110 },
  { title: 'Zalo sống đã lưu', key: 'savedZaloLinks', width: 140 },
  { title: 'Quét lần cuối', key: 'lastCrawledAt', width: 160 },
];

const discoveryHeaders = [
  { title: '#', key: 'rowNumber', width: 64 },
  { title: 'Nick', key: 'account', width: 170, sortable: false },
  { title: 'Link phát hiện', key: 'link', sortable: false },
  { title: 'Nguồn tin', key: 'source', sortable: false },
  { title: 'TV', key: 'memberCount', width: 90 },
  { title: 'Nhắn tin', key: 'canSendMessage', width: 120 },
  { title: 'Trạng thái', key: 'checkStatus', width: 130 },
  { title: 'Thời gian tin', key: 'messageSentAt', width: 160 },
  { title: '', key: 'actions', sortable: false, width: 120 },
];

const discoveryScopeOptions = [
  { title: 'Nick đang chọn', value: 'current' },
  { title: 'Tất cả nick có quyền', value: 'all' },
];
const discoveryPlatformOptions = [
  { title: 'Tất cả', value: 'all' },
  { title: 'Zalo', value: 'zalo' },
  { title: 'Telegram', value: 'telegram' },
  { title: 'Facebook', value: 'facebook' },
  { title: 'Web', value: 'web' },
];
const joinJobScopeOptions = [
  { title: 'Link đang chọn', value: 'selected' },
  { title: 'Tất cả link hợp lệ đang lưu', value: 'all' },
];

const linkStatusOptions = [
  { title: 'Tất cả', value: '' },
  { title: 'Chưa kiểm tra', value: 'unchecked' },
  { title: 'Còn sống', value: 'valid' },
  { title: 'Link chết', value: 'dead' },
  { title: 'Không hợp lệ', value: 'invalid' },
  { title: 'Chưa rõ', value: 'unknown' },
];
const joinStatusOptions = [
  { title: 'Tất cả', value: '' },
  { title: 'Chưa join', value: 'not_joined' },
  { title: 'Đang join', value: 'processing' },
  { title: 'Đã gửi yêu cầu', value: 'join_requested' },
  { title: 'Chờ duyệt', value: 'pending_approval' },
  { title: 'Đã tham gia', value: 'joined' },
  { title: 'Đã có sẵn', value: 'already_joined' },
  { title: 'Thất bại', value: 'failed' },
];
const yesNoUnknownOptions = [
  { title: 'Tất cả', value: '' },
  { title: 'Có', value: 'true' },
  { title: 'Không', value: 'false' },
  { title: 'Chưa rõ', value: 'unknown' },
];
const membershipOptions = [
  { title: 'Tất cả', value: '' },
  { title: 'Đã tham gia', value: 'joined' },
  { title: 'Chưa tham gia', value: 'not_joined' },
  { title: 'Chưa rõ', value: 'unknown' },
];
const statItems = computed(() => [
  { label: 'Tổng link', value: linkStats.value.total },
  { label: 'Nhóm sống', value: linkStats.value.valid },
  { label: 'Link chết', value: linkStats.value.dead },
  { label: 'Nick đã tham gia', value: linkStats.value.accountJoined },
  { label: 'Nhắn được', value: linkStats.value.canSend },
  { label: 'Xem TV được', value: linkStats.value.canViewMembers },
  { label: 'Join hôm nay', value: linkStats.value.todayJoins },
]);
const discoveryStatItems = computed(() => [
  { label: 'Tổng link', value: discoveryStats.value.total },
  { label: 'Zalo', value: discoveryStats.value.zalo },
  { label: 'Telegram', value: discoveryStats.value.telegram },
  { label: 'Facebook', value: discoveryStats.value.facebook },
  { label: 'Web', value: discoveryStats.value.web },
  { label: 'Đã lưu Zalo', value: discoveryStats.value.savedZalo },
]);
const tableLinks = computed<GroupLink[]>(() => links.value.map((link: GroupLink, index: number) => ({ ...link, rowNumber: index + 1 })));
const crawlGroupRows = computed<GroupLink[]>(() => crawlGroups.value.map((group: GroupLink, index: number) => ({ ...group, rowNumber: index + 1 })));
const discoveryRows = computed<GroupLink[]>(() => discoveredLinks.value.map((link: GroupLink, index: number) => ({ ...link, rowNumber: index + 1 })));
const selectedRows = computed<GroupLink[]>(() => selected.value.map((id) => links.value.find((link: GroupLink) => link.id === id)).filter(Boolean) as GroupLink[]);
const selectedJoinableRows = computed<GroupLink[]>(() => selectedRows.value.filter((link) => !joinSkipReason(link)));
const importLinkCount = computed(() => splitInputLinks(importText.value).length);
const canScan = computed(() => Boolean(selectedAccountId.value && importText.value.trim() && !checking.value && !actionLoading.value));
const canCrawlDiscoveries = computed(() => discoveryScope.value === 'all' || Boolean(selectedAccountId.value));
const checkPercent = computed(() => checkProgress.total ? Math.round((checkProgress.done / checkProgress.total) * 100) : 0);
const checkSummary = computed(() => `${checking.value ? 'Đang kiểm tra' : 'Đã kiểm tra xong'}: ${checkProgress.alive} nhóm hợp lệ, ${checkProgress.dead} nhóm lỗi/không tồn tại, ${checkProgress.failed} lỗi hệ thống`);

function notify(message: string, color = 'success') {
  snack.message = message;
  snack.color = color;
  snack.show = true;
}

function selectAllLinks() {
  selected.value = [...new Set(tableLinks.value.map((link: GroupLink) => link.id))];
  notify(`Đã chọn ${selected.value.length} link đang lọc`, 'primary');
}

function clearSelectedLinks() {
  selected.value = [];
}

function progressFor(accountId: string) {
  return joinProgressByAccount[accountId] ?? (joinProgressByAccount[accountId] = { total: 0, done: 0, current: '' });
}

function setJoiningId(accountId: string, value = '') {
  if (value) joiningIdByAccount[accountId] = value;
  else delete joiningIdByAccount[accountId];
}

function setJoiningSelected(accountId: string, value: boolean) {
  if (value) joiningSelectedByAccount[accountId] = true;
  else delete joiningSelectedByAccount[accountId];
}

function splitInputLinks(text: string) {
  return text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
}

function params() {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
}

function discoveryParams() {
  const params: Record<string, any> = { limit: discoveryLimit.value };
  if (discoveryPlatform.value !== 'all') params.platform = discoveryPlatform.value;
  if (discoveryScope.value === 'current' && selectedAccountId.value) params.accountId = selectedAccountId.value;
  return params;
}

async function loadDiscoveries() {
  if (discoveryScope.value === 'current' && !selectedAccountId.value) return;
  await Promise.all([
    fetchGroupLinkDiscoveries(discoveryParams()),
    fetchGroupLinkCrawlGroups(discoveryParams()),
  ]);
  const visible = new Set(crawlGroups.value.map((group: GroupLink) => group.conversationId || group.id));
  selectedCrawlGroups.value = selectedCrawlGroups.value.filter((id) => visible.has(id));
}

async function crawlDiscoveries(conversationIds: string[] = []) {
  if (!canCrawlDiscoveries.value || crawlingDiscoveries.value) return;
  crawlingDiscoveries.value = true;
  Object.assign(crawlResult, { message: 'Đang quét tin nhắn đã lưu...', type: 'info' });
  const payload: Record<string, any> = {
    ...discoveryParams(),
    days: discoveryDays.value,
    autoCheck: discoveryAutoCheck.value,
  };
  if (conversationIds.length) payload.conversationIds = conversationIds;
  try {
    const result = await crawlGroupLinkDiscoveries(payload);
    const stats = result.crawlStats ?? {};
    const message = `Đã quét ${stats.crawledGroups ?? 0} nhóm, ${stats.scannedMessages ?? 0} tin: ${stats.inserted ?? 0} link mới, bỏ qua ${stats.existing ?? 0} lượt link trùng, lưu sống ${stats.savedZalo ?? 0}, chờ kiểm tra ${stats.savedUnverified ?? 0}`;
    Object.assign(crawlResult, { message, type: 'success' });
    notify(message, 'primary');
    try {
      await loadDiscoveries();
      if (selectedAccountId.value) await fetchGroupLinks(selectedAccountId.value, params());
      await scrollToDiscoveries();
    } catch {
      Object.assign(crawlResult, { message: `${message}. Tải lại bảng thất bại; bấm Làm mới để xem dữ liệu đã lưu.`, type: 'warning' });
    }
  } catch (err: any) {
    const message = err?.response?.data?.error ?? (err?.code === 'ECONNABORTED'
      ? 'Quét quá thời gian chờ. Bấm Làm mới để kiểm tra dữ liệu đã lưu.'
      : `Quét link thất bại: ${err?.message ?? 'Không kết nối được máy chủ'}`);
    Object.assign(crawlResult, { message, type: 'error' });
    notify(message, 'error');
  } finally {
    crawlingDiscoveries.value = false;
  }
}

async function scrollToDiscoveries() {
  await nextTick();
  discoveriesEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function crawlSelectedGroups() {
  await crawlDiscoveries(selectedCrawlGroups.value);
}

async function crawlAllGroups() {
  await crawlDiscoveries(crawlGroupRows.value.map((group: GroupLink) => group.conversationId));
}

async function reload() {
  if (!selectedAccountId.value) return;
  await Promise.all([
    fetchGroupLinks(selectedAccountId.value, params()),
    loadDiscoveries(),
    loadJoinJobs(),
  ]);
  const visible = new Set(links.value.map((link: GroupLink) => link.id));
  selected.value = selected.value.filter((id) => visible.has(id));
}

async function loadJoinJobs() {
  if (!selectedAccountId.value) return;
  await fetchGroupJoinJobs(selectedAccountId.value);
}

function openJoinJobDialog(scope: 'selected' | 'all') {
  editingJoinJobId.value = '';
  joinJobScope.value = scope;
  joinJobMaxPerDay.value = 20;
  joinJobDelayMinSeconds.value = 30;
  joinJobDelayMaxSeconds.value = 90;
  joinJobStopAt.value = '';
  joinJobAutoStart.value = true;
  joinJobLinkStatus.value = filters.linkStatus || 'valid';
  joinJobCanSendMessage.value = filters.canSendMessage;
  joinJobCanViewMembers.value = filters.canViewMembers;
  joinJobMembershipStatus.value = filters.membershipStatus;
  joinJobDialog.value = true;
}

async function saveJoinJob() {
  if (!selectedAccountId.value) return;
  const linkIds = joinJobScope.value === 'selected' ? selected.value : [];
  if (!editingJoinJobId.value && joinJobScope.value === 'selected' && !linkIds.length) return notify('Chưa chọn link để tạo job', 'warning');
  const payload = {
    linkIds,
    all: joinJobScope.value === 'all',
    maxPerDay: joinJobMaxPerDay.value,
    delayMinSeconds: joinJobDelayMinSeconds.value,
    delayMaxSeconds: joinJobDelayMaxSeconds.value,
    stopAt: joinJobStopAt.value || undefined,
    autoStart: joinJobAutoStart.value,
    linkStatus: joinJobLinkStatus.value,
    canSendMessage: joinJobCanSendMessage.value,
    canViewMembers: joinJobCanViewMembers.value,
    membershipStatus: joinJobMembershipStatus.value,
  };
  try {
    if (editingJoinJobId.value) {
      await updateGroupJoinJob(selectedAccountId.value, editingJoinJobId.value, payload);
      if (joinJobAutoStart.value) await startGroupJoinJob(selectedAccountId.value, editingJoinJobId.value);
      notify('Đã lưu job auto join');
    } else {
      await createGroupJoinJob(selectedAccountId.value, payload);
      notify(joinJobAutoStart.value ? 'Đã tạo và chạy job auto join' : 'Đã lưu job auto join');
    }
    joinJobDialog.value = false;
    await reload();
  } catch (err: any) {
    notify(err?.response?.data?.error ?? 'Lưu job thất bại', 'error');
  }
}

function editJoinJob(job: GroupLink) {
  editingJoinJobId.value = job.id;
  joinJobScope.value = 'selected';
  selected.value = Array.isArray(job.linkIds) ? job.linkIds : [];
  joinJobMaxPerDay.value = job.maxPerDay ?? 20;
  joinJobDelayMinSeconds.value = Math.max(10, Math.round((job.delayMinMs ?? 30000) / 1000));
  joinJobDelayMaxSeconds.value = Math.max(joinJobDelayMinSeconds.value, Math.round((job.delayMaxMs ?? 90000) / 1000));
  joinJobStopAt.value = job.stopAt ? toLocalInputTime(job.stopAt) : '';
  joinJobAutoStart.value = false;
  joinJobLinkStatus.value = 'valid';
  joinJobCanSendMessage.value = '';
  joinJobCanViewMembers.value = '';
  joinJobMembershipStatus.value = '';
  joinJobDialog.value = true;
}

async function startJoinJob(jobId: string) {
  if (!selectedAccountId.value) return;
  try {
    await startGroupJoinJob(selectedAccountId.value, jobId);
    notify('Đã start job auto join');
    await reload();
  } catch (err: any) {
    notify(err?.response?.data?.error ?? 'Start job thất bại', 'error');
  }
}

async function stopJoinJob(jobId: string) {
  if (!selectedAccountId.value) return;
  try {
    await stopGroupJoinJob(selectedAccountId.value, jobId);
    notify('Đã dừng job auto join', 'warning');
    await loadJoinJobs();
  } catch (err: any) {
    notify(err?.response?.data?.error ?? 'Dừng job thất bại', 'error');
  }
}

async function deleteJoinJob(jobId: string) {
  if (!selectedAccountId.value || !window.confirm('Xóa job auto join này?')) return;
  try {
    await deleteGroupJoinJob(selectedAccountId.value, jobId);
    notify('Đã xóa job auto join');
    await loadJoinJobs();
  } catch (err: any) {
    notify(err?.response?.data?.error ?? 'Xóa job thất bại', 'error');
  }
}

async function scanPastedLinks() {
  if (!selectedAccountId.value || checking.value) return;
  const stats = await importGroupLinks(selectedAccountId.value, importText.value) as ImportStats;
  const ids = [...new Set(stats.batchLinkIds ?? [])];
  notify(`Nhập ${stats.total} link: lưu mới ${stats.saved}, trùng ${stats.duplicate + stats.existing}, lỗi ${stats.invalid}`, 'primary');
  await runChecks(ids);
}

async function checkSelected() {
  await runChecks(selected.value);
}

async function checkVisible() {
  await runChecks(tableLinks.value.map((link: GroupLink) => link.id));
}

async function checkOne(item: GroupLink) {
  await runChecks([item.id]);
}

async function runChecks(ids: string[]) {
  if (!selectedAccountId.value || checking.value) return;
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (!uniqueIds.length) {
    await reload();
    return;
  }
  checking.value = true;
  stopRequested.value = false;
  Object.assign(checkProgress, { total: uniqueIds.length, done: 0, alive: 0, dead: 0, failed: 0, current: '' });
  try {
    for (const id of uniqueIds) {
      if (stopRequested.value) break;
      checkingId.value = id;
      const current = links.value.find((link: GroupLink) => link.id === id);
      checkProgress.current = current?.normalizedLink ?? id;
      try {
        const result = await checkGroupLink(selectedAccountId.value, id, false);
        if (result?.link) replaceLink(result.link);
        if (result?.alive) checkProgress.alive++;
        else checkProgress.dead++;
      } catch {
        checkProgress.failed++;
      } finally {
        checkProgress.done++;
        checkingId.value = '';
      }
      if (!stopRequested.value && checkProgress.done < uniqueIds.length) {
        await wait(Math.max(0, Math.min(5000, Number(checkDelayMs.value) || 0)));
      }
    }
  } finally {
    checking.value = false;
    checkingId.value = '';
    checkProgress.current = '';
    await reload();
  }
}

async function joinOne(item: GroupLink) {
  if (!selectedAccountId.value || joiningSelected.value || joinDisabled(item)) return;
  const accountId = selectedAccountId.value;
  setJoiningId(accountId, item.id);
  try {
    const link = await joinGroupLink(accountId, item.id, false);
    if (link && selectedAccountId.value === accountId) replaceLink(link);
    notify(link?.joinStatus === 'pending_approval' ? 'Đã gửi yêu cầu, chờ trưởng nhóm duyệt' : 'Đã tham gia nhóm', 'success');
  } catch (err: any) {
    if (err?.response?.data?.link && selectedAccountId.value === accountId) replaceLink(err.response.data.link);
    const error = joinErrorText(err);
    notify(isRateLimitedJoinError(error, err) ? 'Zalo đang giới hạn thao tác nhóm. Đã dừng request, thử lại sau.' : error, isRateLimitedJoinError(error, err) ? 'warning' : 'error');
  } finally {
    setJoiningId(accountId);
    if (selectedAccountId.value === accountId) await reload();
  }
}

async function joinSelected() {
  if (!selectedAccountId.value || joiningSelected.value || checking.value) return;
  const accountId = selectedAccountId.value;
  const rows = selectedRows.value.map((row) => ({ ...row }));
  if (!rows.length) return notify('Không tìm thấy link đã chọn', 'warning');

  const progress = progressFor(accountId);
  setJoiningSelected(accountId, true);
  setJoiningId(accountId);
  progress.total = rows.length;
  progress.done = 0;
  progress.current = '';
  let joined = 0;
  let pending = 0;
  let failed = 0;
  let skipped = 0;
  let attempted = 0;
  let rateLimited = false;
  let rateLimitError = '';
  const skippedReasons: Record<string, number> = {};
  const failedErrors: string[] = [];
  try {
    for (const item of rows) {
      progress.current = item.groupName || item.normalizedLink || item.id;
      const current = selectedAccountId.value === accountId ? (links.value.find((link: GroupLink) => link.id === item.id) ?? item) : item;
      const skipReason = joinSkipReason(current);
      if (skipReason) {
        skipped++;
        skippedReasons[skipReason] = (skippedReasons[skipReason] ?? 0) + 1;
        progress.done++;
        continue;
      }
      if (attempted) await wait(randomManualJoinDelayMs());
      attempted++;
      setJoiningId(accountId, item.id);
      let completed = false;
      for (let attempt = 0; attempt < 2 && !completed; attempt++) {
        try {
          const link = await joinGroupLink(accountId, item.id, false);
          if (link && selectedAccountId.value === accountId) replaceLink(link);
          if (link?.joinStatus === 'pending_approval' || link?.joinStatus === 'join_requested') pending++;
          else joined++;
          completed = true;
        } catch (err: any) {
          const error = joinErrorText(err);
          if (isRateLimitedJoinError(error, err)) {
            rateLimited = true;
            rateLimitError = error;
            break;
          }
          failed++;
          if (err?.response?.data?.link && selectedAccountId.value === accountId) replaceLink(err.response.data.link);
          failedErrors.push(error);
        }
      }
      if (rateLimited) break;
      progress.done++;
    }
  } finally {
    setJoiningSelected(accountId, false);
    setJoiningId(accountId);
    progress.current = '';
    if (selectedAccountId.value === accountId) await reload();
  }
  const skipText = Object.entries(skippedReasons).map(([reason, count]) => `${reason} ${count}`).join(', ');
  const errorText = [...new Set(failedErrors)].slice(0, 2).join(' | ');
  if (rateLimited) {
    notify(`Đã dừng tại ${progress.done}/${rows.length}: Zalo đang giới hạn thao tác nhóm. Chờ hết giới hạn rồi chạy tiếp.${rateLimitError ? ` (${rateLimitError})` : ''}`, 'warning');
    return;
  }
  notify(
    `${accountName(accountId)}: Đã xử lý ${progress.done}/${rows.length}: tham gia ${joined}, chờ duyệt ${pending}, lỗi ${failed}, bỏ qua ${skipped}${skipText ? ` (${skipText})` : ''}${errorText ? `; lỗi: ${errorText}` : ''}`,
    failed ? 'warning' : 'success',
  );
}

function randomManualJoinDelayMs() {
  const min = Math.max(10, Number(manualJoinDelayMinSeconds.value) || 10);
  const max = Math.max(min, Number(manualJoinDelayMaxSeconds.value) || min);
  return (min + Math.floor(Math.random() * (max - min + 1))) * 1000;
}

function joinErrorText(err: any) {
  return String(err?.response?.data?.link?.lastError ?? err?.response?.data?.error ?? err?.message ?? 'Tham gia thất bại');
}

function isRateLimitedJoinError(error: string, err?: any) {
  return err?.response?.status === 429 ||
    err?.response?.data?.rateLimited === true ||
    /quá nhanh|group_read|group_admin|vượt quá số request|rate.?limit|quota/i.test(error);
}

async function joinDiscovered(item: GroupLink) {
  if (!canJoinDiscovered(item)) return;
  setJoiningId(item.zaloAccountId, `discovery:${item.id}`);
  try {
    const link = await joinGroupLink(item.zaloAccountId, item.savedZaloGroupLinkId, false);
    if (link && selectedAccountId.value === item.zaloAccountId) replaceLink(link);
    notify(link?.joinStatus === 'pending_approval' ? 'Đã gửi yêu cầu, chờ trưởng nhóm duyệt' : 'Đã tham gia nhóm', 'success');
  } catch (err: any) {
    if (err?.response?.data?.link && selectedAccountId.value === item.zaloAccountId) replaceLink(err.response.data.link);
    notify(err?.response?.data?.error ?? 'Tham gia thất bại', 'error');
  } finally {
    setJoiningId(item.zaloAccountId);
    await loadDiscoveries();
    if (selectedAccountId.value) await fetchGroupLinks(selectedAccountId.value, params());
  }
}

function joinDisabled(item: GroupLink) {
  return Boolean(joinSkipReason(item));
}

function joinSkipReason(item: GroupLink) {
  if (checkingId.value === item.id || joiningId.value === item.id) return 'đang xử lý';
  if (['dead', 'invalid', 'duplicate'].includes(item.linkStatus)) return linkText(item.linkStatus);
  if (item.accountMembershipStatus === 'joined' || item.joinStatus === 'joined' || item.joinStatus === 'already_joined') return 'đã tham gia';
  if (item.joinStatus === 'processing') return 'đang join';
  if (item.joinStatus === 'pending_approval' || item.joinStatus === 'join_requested') return 'chờ duyệt';
  return '';
}

function canJoinDiscovered(item: GroupLink) {
  return item.platform === 'zalo' &&
    Boolean(item.savedZaloGroupLinkId) &&
    item.checkStatus === 'valid' &&
    joiningId.value !== `discovery:${item.id}`;
}

function replaceLink(updated: GroupLink) {
  const index = links.value.findIndex((link: GroupLink) => link.id === updated.id);
  if (index !== -1) links.value.splice(index, 1, { ...links.value[index], ...updated });
}

async function pasteClipboard() {
  const text = await navigator.clipboard?.readText?.();
  if (text) importText.value = [importText.value, text].filter(Boolean).join('\n');
}

async function readFiles() {
  const files = Array.isArray(importFiles.value) ? importFiles.value : importFiles.value ? [importFiles.value] : [];
  const parts: string[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.value ?? '')))));
    } else {
      parts.push(await file.text());
    }
  }
  importText.value = [importText.value, ...parts].filter(Boolean).join('\n');
}

async function exportExcel(onlySelected = false) {
  const ids = new Set(selected.value);
  const rows = onlySelected ? links.value.filter((link: GroupLink) => ids.has(link.id)) : links.value;
  if (!rows.length) return notify(onlySelected ? 'Chưa chọn link để xuất Excel' : 'Không có link để xuất Excel', 'warning');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Link nhóm');
  sheet.columns = [
    { header: 'Tên nhóm', key: 'groupName', width: 36 },
    { header: 'Link', key: 'normalizedLink', width: 36 },
    { header: 'Group ID', key: 'groupId', width: 24 },
    { header: 'TV', key: 'memberCount', width: 10 },
    { header: 'Xem TV', key: 'canViewMembers', width: 12 },
    { header: 'Nhắn tin', key: 'canSendMessage', width: 12 },
    { header: 'Nick này', key: 'accountMembershipStatus', width: 16 },
    { header: 'Tình trạng link', key: 'linkStatus', width: 16 },
    { header: 'Trạng thái join', key: 'joinStatus', width: 18 },
    { header: 'Lần kiểm tra', key: 'lastCheckedAt', width: 22 },
    { header: 'Lỗi', key: 'lastError', width: 40 },
  ];
  rows.forEach((row: GroupLink) => sheet.addRow({
    ...row,
    canViewMembers: boolText(row.canViewMembers),
    canSendMessage: boolText(row.canSendMessage),
    accountMembershipStatus: membershipText(row.accountMembershipStatus),
    lastCheckedAt: formatTime(row.lastCheckedAt),
  }));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zalo-group-links-${onlySelected ? 'selected-' : ''}${selectedAccountId.value || 'all'}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function onAccountChange(id: string) {
  selectAccount(id);
  selected.value = [];
  selectedCrawlGroups.value = [];
  await reload();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function accountName(accountId: string) {
  const account = accounts.value.find((item: GroupLink) => item.id === accountId);
  return account?.displayName || account?.phone || accountId;
}

function platformText(platform: string) {
  return ({ zalo: 'Zalo', telegram: 'Telegram', facebook: 'Facebook', web: 'Web' } as Record<string, string>)[platform] ?? platform;
}

function platformColor(platform: string) {
  return ({ zalo: 'success', telegram: 'info', facebook: 'primary', web: 'secondary' } as Record<string, string>)[platform] ?? 'default';
}

function boolText(value: boolean | null | undefined) {
  if (value === true) return 'Có';
  if (value === false) return 'Không';
  return 'Chưa rõ';
}

function boolColor(value: boolean | null | undefined) {
  if (value === true) return 'success';
  if (value === false) return 'error';
  return 'warning';
}

function membershipText(state: string) {
  if (state === 'joined') return 'Đã tham gia';
  if (state === 'not_joined') return 'Chưa tham gia';
  return 'Chưa rõ';
}

function membershipColor(state: string) {
  if (state === 'joined') return 'success';
  if (state === 'not_joined') return 'primary';
  return 'warning';
}

function linkText(state: string) {
  return ({
    unchecked: 'Chưa kiểm tra',
    valid: 'Còn sống',
    dead: 'Link chết',
    invalid: 'Không hợp lệ',
    unknown: 'Chưa rõ',
  } as Record<string, string>)[state] ?? state;
}

function linkColor(state: string) {
  if (state === 'valid') return 'success';
  if (state === 'dead' || state === 'invalid') return 'error';
  if (state === 'unchecked' || state === 'unknown') return 'warning';
  return 'primary';
}

function joinText(state: string) {
  return ({
    not_joined: 'Chưa join',
    processing: 'Đang join',
    join_requested: 'Đã gửi yêu cầu',
    pending_approval: 'Chờ duyệt',
    joined: 'Đã tham gia',
    already_joined: 'Đã có sẵn',
    failed: 'Thất bại',
  } as Record<string, string>)[state] ?? state;
}

function joinColor(state: string) {
  if (state === 'joined' || state === 'already_joined') return 'success';
  if (state === 'failed') return 'error';
  if (state === 'pending_approval' || state === 'join_requested') return 'warning';
  return 'primary';
}

function shortId(id: string | null | undefined) {
  const value = String(id ?? '');
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function joinJobStateText(state: string) {
  return ({
    draft: 'Nháp',
    queued: 'Đang chờ',
    running: 'Đang chạy',
    waiting: 'Chờ ngày mới',
    stopped: 'Đã dừng',
    completed: 'Hoàn tất',
    failed: 'Lỗi',
  } as Record<string, string>)[state] ?? state;
}

function joinJobStateColor(state: string) {
  if (state === 'running') return 'success';
  if (state === 'queued') return 'info';
  if (state === 'waiting') return 'warning';
  if (state === 'failed') return 'error';
  return 'default';
}

function joinJobLogText(state: string) {
  return ({
    joined: 'Đã join',
    pending: 'Chờ duyệt',
    already_joined: 'Đã tham gia',
    skipped: 'Bỏ qua',
    failed: 'Thất bại',
  } as Record<string, string>)[state] ?? state;
}

function joinJobDelayLabel(job: GroupLink) {
  const min = Math.max(10, Math.round((job.delayMinMs ?? 30000) / 1000));
  const max = Math.max(min, Math.round((job.delayMaxMs ?? 60000) / 1000));
  return min === max ? `${min}s` : `${min}-${max}s`;
}

function toLocalInputTime(value: string) {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('vi-VN') : '';
}

onMounted(reload);
</script>

<style scoped>
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.border-t { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.group-links-page {
  min-height: calc(100vh - 92px);
  padding-bottom: 72px;
}
.table-card { overflow: visible; }
.link-check-progress {
  min-height: 30px;
}
.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  scroll-margin-top: 12px;
}
.link-table :deep(.v-table__wrapper),
.crawl-group-table :deep(.v-table__wrapper),
.discovery-table :deep(.v-table__wrapper) {
  overflow-x: auto;
  overflow-y: visible;
}
.link-table :deep(table) {
  min-width: 1500px;
}
.crawl-group-table :deep(table) {
  min-width: 980px;
}
.discovery-table :deep(table) {
  min-width: 1320px;
}
.link-table :deep(td),
.crawl-group-table :deep(td),
.discovery-table :deep(td) { vertical-align: middle; }
.join-job-row {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 12px;
}
.join-job-log {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
}
.link-table :deep(th:last-child),
.link-table :deep(td:last-child) {
  position: sticky;
  right: 0;
  z-index: 2;
  background: rgb(var(--v-theme-surface));
  box-shadow: -1px 0 0 rgba(var(--v-border-color), var(--v-border-opacity));
}
.link-table :deep(th:last-child) {
  z-index: 3;
}
.text-truncate { max-width: 360px; }
</style>
