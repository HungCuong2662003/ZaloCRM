<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  Feature E1 — Quét nhóm & thành viên.
  4 màn (theo docs/quet-group/mockup.html):
   1. pick   — chọn nhóm (checkbox) + "Quét tất cả" + thanh hành động sticky
   2. scanning — poll trạng thái mỗi ~2s tới khi completed/partial/failed
   3. roster — bảng thành viên + chip isFriend + lọc Tất cả/Là bạn/Người lạ
   (partial = roster + cảnh báo "quét 1 phần")
-->
<template>
  <div class="d-flex flex-column h-100">
    <!-- Toolbar: account picker + back to groups -->
    <div class="d-flex align-center pa-4 pb-2 gap-3">
      <div>
        <div class="text-caption text-medium-emphasis">Nhóm Zalo / Quét thành viên</div>
        <h1 class="text-h5">Quét nhóm &amp; thành viên</h1>
      </div>
      <v-spacer />
      <v-select
        v-model="selectedAccountId"
        :items="accounts"
        item-title="displayName"
        item-value="id"
        label="Tài khoản"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 240px"
        :loading="accountLoading"
        @update:model-value="onAccountChange"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps">
            <template #append>
              <v-chip
                size="x-small"
                :color="acctOnline(item) ? 'success' : 'error'"
                variant="tonal"
              >
                {{ acctOnline(item) ? 'Online' : 'Offline' }}
              </v-chip>
            </template>
          </v-list-item>
        </template>
      </v-select>
    </div>

    <div class="group-scan-body flex-1-1 px-4 pb-4">
      <!-- ════════ STATE 1: PICK GROUPS ════════ -->
      <v-card v-if="phase === 'pick'" variant="outlined" class="pick-card d-flex flex-column">
        <div class="d-flex align-center gap-3 pa-4 border-b">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Chọn nhóm để quét thành viên</div>
            <div class="text-caption text-medium-emphasis">
              Đang tham gia {{ groups.length }} nhóm · tick nhóm cần lấy danh sách thành viên
            </div>
          </div>
          <v-spacer />
          <v-btn
            variant="outlined"
            prepend-icon="mdi-flash"
            :disabled="!groups.length || scanLoading"
            :loading="scanLoading && startMode === 'all'"
            @click="startScan(true)"
          >
            Quét tất cả {{ groups.length }} nhóm
          </v-btn>
        </div>

        <!-- search + select-all -->
        <div class="d-flex align-center gap-3 pa-3 border-b flex-wrap">
          <v-text-field
            v-model="search"
            placeholder="Tìm nhóm..."
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 360px"
          />
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-select-all" @click="selectAllGroups">
            Chọn tất cả nhóm
          </v-btn>
          <v-btn variant="text" prepend-icon="mdi-check-all" @click="toggleSelectAll">
            {{ allFilteredSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả' }}
          </v-btn>
        </div>

        <!-- group list with checkboxes -->
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <div v-if="!loading && !filteredGroups.length" class="pa-12 text-center text-medium-emphasis">
          <v-icon size="48" class="mb-3" color="primary">mdi-account-group-outline</v-icon>
          <div class="text-subtitle-1">Chưa có nhóm nào</div>
          <div class="text-body-2">Nick phải đang là thành viên của nhóm để quét.</div>
        </div>
        <v-list v-else lines="two" density="comfortable" class="group-list-scroll">
          <v-list-item
            v-for="g in filteredGroups"
            :key="g.id"
            @click="toggleGroup(g.id)"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="selectedIds.has(g.id)"
                color="primary"
                @click.stop="toggleGroup(g.id)"
              />
              <v-avatar :color="avatarColor(g.id)" size="42" rounded="lg" class="ml-1 mr-3">
                <span class="text-white font-weight-bold">{{ initials(groupName(g)) }}</span>
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-medium">{{ groupName(g) }}</v-list-item-title>
            <v-list-item-subtitle class="d-flex align-center gap-2">
              <v-icon size="14">mdi-account-multiple</v-icon>
              <span>{{ g.totalMember ?? g.totalMembers ?? 0 }} thành viên</span>
              <v-chip v-if="isCommunity(g)" size="x-small" color="warning" variant="tonal">
                <v-icon start size="12">mdi-office-building</v-icon> Cộng đồng
              </v-chip>
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <!-- sticky action bar -->
        <div class="d-flex align-center gap-3 pa-3 border-t sticky-bar">
          <div class="text-body-2 font-weight-medium">
            Đã chọn <span class="text-primary font-weight-bold">{{ selectedIds.size }}</span> nhóm
            <span v-if="selectedIds.size" class="text-medium-emphasis">
              · ước tính <span class="text-primary">~{{ estimatedMembers.toLocaleString('vi') }}</span> thành viên
            </span>
          </div>
          <v-spacer />
          <v-btn
            variant="outlined"
            prepend-icon="mdi-clipboard-pulse"
            @click="openJobsMonitor"
          >
            Theo dõi job
            <template v-if="runningJobs.length">({{ runningJobs.length }})</template>
          </v-btn>
          <v-btn variant="text" :disabled="!selectedIds.size" @click="selectedIds.clear()">Bỏ chọn</v-btn>
          <v-btn
            variant="outlined"
            prepend-icon="mdi-send"
            :disabled="!selectedIds.size"
            @click="openNewSendDialog"
          >
            Gửi tin nhóm
          </v-btn>
          <v-btn
            variant="outlined"
            prepend-icon="mdi-robot"
            :disabled="!selectedIds.size"
            @click="openNewServiceDialog"
          >
            Auto dịch vụ
          </v-btn>
          <v-btn
            color="primary"
            prepend-icon="mdi-download"
            :disabled="!selectedIds.size || scanLoading"
            :loading="scanLoading && startMode === 'selected'"
            @click="startScan(false)"
          >
            Bắt đầu quét
          </v-btn>
        </div>
      </v-card>

      <!-- ════════ STATE 2: SCANNING ════════ -->
      <v-card v-else-if="phase === 'scanning'" variant="outlined">
        <div class="d-flex align-center gap-3 pa-4 border-b">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Đang quét thành viên</div>
            <div class="text-caption text-medium-emphasis">
              Chạy nền — bạn có thể rời trang, quá trình không dừng
            </div>
          </div>
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-arrow-left" @click="backToPick">Quét nhóm khác</v-btn>
        </div>

        <div class="pa-5">
          <div class="d-flex align-center gap-4 mb-4">
            <v-progress-circular indeterminate color="primary" size="38" width="3" />
            <div class="flex-1-1">
              <div class="font-weight-medium">Đang quét {{ scan?.scannedGroups ?? 0 }}/{{ scan?.totalGroups ?? 0 }} nhóm</div>
              <v-progress-linear
                :model-value="scanProgress"
                color="primary"
                height="8"
                rounded
                class="my-1"
              />
              <div class="text-caption text-medium-emphasis">
                Đã quét {{ scan?.scannedGroups ?? 0 }} / {{ scan?.totalGroups ?? 0 }} nhóm
              </div>
            </div>
            <div class="text-h6 text-primary font-weight-bold">{{ scanProgress }}%</div>
          </div>

          <div class="stat-grid">
            <v-card variant="tonal" color="surface-variant" class="pa-4">
              <div class="text-caption text-medium-emphasis d-flex align-center gap-1">
                <v-icon size="16">mdi-account-group</v-icon> Nhóm đã xong
              </div>
              <div class="text-h5 font-weight-bold mt-1">
                {{ scan?.scannedGroups ?? 0 }}
                <span class="text-body-2 text-medium-emphasis">/ {{ scan?.totalGroups ?? 0 }}</span>
              </div>
            </v-card>
            <v-card variant="tonal" color="surface-variant" class="pa-4">
              <div class="text-caption text-medium-emphasis d-flex align-center gap-1">
                <v-icon size="16">mdi-account</v-icon> Thành viên đã lưu
              </div>
              <div class="text-h5 font-weight-bold mt-1">{{ scan?.memberCount ?? 0 }}</div>
            </v-card>
            <v-card variant="tonal" color="surface-variant" class="pa-4">
              <div class="text-caption text-medium-emphasis d-flex align-center gap-1">
                <v-icon size="16">mdi-handshake</v-icon> Là bạn của nick
              </div>
              <div class="text-h5 font-weight-bold mt-1">
                {{ scan?.friendCount ?? '—' }}
              </div>
            </v-card>
          </div>

          <v-alert type="info" variant="tonal" density="compact" class="mt-4" icon="mdi-lock">
            Quét bị giới hạn tốc độ để bảo vệ nick — nhóm lớn có thể mất vài phút.
            Tiến độ được lưu, nếu mất kết nối sẽ quét tiếp từ chỗ dở.
          </v-alert>
        </div>
      </v-card>

      <!-- ════════ STATE 3 / 4: ROSTER (completed / partial) ════════ -->
      <v-card v-else-if="phase === 'roster'" variant="outlined" class="roster-card d-flex flex-column">
        <div class="d-flex align-center gap-3 pa-4 border-b">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Thành viên đã quét</div>
            <div class="text-caption text-medium-emphasis">
              {{ totalMembers }} thành viên · {{ friendCount }} là bạn của nick
            </div>
          </div>
          <v-spacer />
          <v-btn variant="outlined" prepend-icon="mdi-account-plus" :loading="actionLoading" @click="saveContacts">
            Lưu khách hàng
          </v-btn>
          <v-btn variant="outlined" prepend-icon="mdi-account-search-outline" @click="openSavedMembers">
            Mở thành viên đã lưu
          </v-btn>
          <v-btn variant="outlined" prepend-icon="mdi-file-excel" @click="exportMembers">
            Xuất Excel
          </v-btn>
          <v-btn variant="text" prepend-icon="mdi-refresh" @click="backToPick">Quét lại</v-btn>
        </div>

        <!-- partial warning (state 4) -->
        <v-alert
          v-if="scan?.state === 'partial'"
          type="warning"
          variant="tonal"
          class="ma-4 mb-0"
          icon="mdi-alert"
        >
          <b>Quét xong một phần.</b> Một số nhóm bị giới hạn do cộng đồng quá lớn.
          Bạn có thể quét lại để lấy nốt phần còn thiếu — phần đã lưu vẫn dùng được.
        </v-alert>
        <v-alert
          v-else-if="scan?.state === 'failed'"
          type="error"
          variant="tonal"
          class="ma-4 mb-0"
          icon="mdi-close-circle"
        >
          <b>Quét thất bại.</b> Vui lòng thử lại — phần thành viên đã lưu (nếu có) vẫn hiển thị bên dưới.
        </v-alert>

        <!-- search + filter segments -->
        <div class="d-flex align-center gap-3 pa-3 border-b flex-wrap">
          <v-text-field
            v-model="memberSearch"
            placeholder="Tìm thành viên..."
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 320px"
          />
          <v-spacer />
          <v-btn-toggle
            v-model="friendFilter"
            color="primary"
            density="comfortable"
            variant="outlined"
            divided
            mandatory
            @update:model-value="onFilterChange"
          >
            <v-btn value="all">Tất cả</v-btn>
            <v-btn value="friend">Là bạn</v-btn>
            <v-btn value="stranger">Người lạ</v-btn>
          </v-btn-toggle>
        </div>

        <v-alert type="info" variant="tonal" density="compact" class="ma-4 mb-0" icon="mdi-information">
          <b>Mẹo an toàn:</b> Người lạ chưa kết bạn — nhắn hàng loạt dễ bị khóa nick.
          Chiến dịch nên lọc <b>"Là bạn"</b> hoặc bật bước kết bạn trước.
        </v-alert>

        <div class="roster-table-wrap">
          <v-data-table
            :headers="memberHeaders"
            :items="filteredMembers"
            :loading="scanMembersLoading"
            :search="memberSearch"
            item-value="id"
            density="comfortable"
          >
            <template #item.member="{ item }">
              <div class="d-flex align-center gap-3 py-1">
                <v-avatar :image="item.avatarUrl || undefined" :color="avatarColor(item.id)" size="36">
                  <span v-if="!item.avatarUrl" class="text-white font-weight-bold text-caption">
                    {{ initials(item.displayName || item.zaloName) }}
                  </span>
                </v-avatar>
                <div>
                  <div class="font-weight-medium">{{ item.displayName || item.zaloName || '—' }}</div>
                  <div class="text-caption text-medium-emphasis">{{ item.zaloName || '—' }}</div>
                </div>
              </div>
            </template>
            <template #item.memberUid="{ item }">
              <span class="text-caption text-medium-emphasis">{{ item.memberUid }}</span>
            </template>
            <template #item.isFriend="{ item }">
              <v-chip v-if="item.isFriend" size="small" color="success" variant="tonal">
                <v-icon start size="13">mdi-handshake</v-icon> Là bạn
              </v-chip>
              <v-chip v-else size="small" color="error" variant="tonal">
                <v-icon start size="13">mdi-account-off</v-icon> Người lạ
              </v-chip>
            </template>
            <template #item.isAdmin="{ item }">
              <v-chip v-if="item.isAdmin" size="small" color="primary" variant="tonal">Admin</v-chip>
              <span v-else class="text-medium-emphasis">—</span>
            </template>
            <template #item.harvestedAt="{ item }">
              <span class="text-medium-emphasis">{{ formatTime(item.harvestedAt) }}</span>
            </template>
          </v-data-table>
        </div>
      </v-card>
    </div>

    <!-- snackbar -->
    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000" location="bottom end">
      {{ snack.message }}
    </v-snackbar>

    <v-dialog v-model="sendDialog" max-width="760" scrollable>
      <v-card class="group-send-dialog">
        <v-card-title>{{ editingJobId ? 'Sửa job gửi nhóm' : 'Gửi tin vào nhóm đã chọn' }}</v-card-title>
        <v-card-text class="group-send-form">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
            Chỉ gửi nội dung phù hợp tới nhóm bạn có quyền gửi. Giãn nhịp gửi tối thiểu 10 giây. Trần an toàn SDK vẫn áp dụng.
          </v-alert>
          <QuickMessageSelect v-model="sendMessage" />
          <v-textarea
            v-model="sendMessage"
            label="Nội dung"
            rows="5"
            variant="outlined"
            counter="2000"
            maxlength="2000"
          />
          <div class="image-picker">
            <div class="d-flex align-center gap-2 flex-wrap">
              <v-btn variant="outlined" prepend-icon="mdi-image-plus" @click="sendImageInput?.click()">
                Chọn ảnh
              </v-btn>
              <span class="text-caption text-medium-emphasis">Tối đa 5 ảnh, mỗi ảnh 5MB</span>
            </div>
            <input
              ref="sendImageInput"
              class="hidden-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              @change="onSelectSendImages"
            />
            <div v-if="imagePreviews.length" class="image-preview-grid">
              <div v-for="image in imagePreviews" :key="image.key" class="image-preview-item">
                <img v-if="image.src" :src="image.src" alt="Ảnh gửi kèm" />
                <div v-else class="image-preview-placeholder">{{ image.name || 'Ảnh' }}</div>
                <v-btn
                  class="image-preview-remove"
                  icon="mdi-close"
                  size="x-small"
                  variant="flat"
                  color="error"
                  @click="removeSendImage(image)"
                />
              </div>
            </div>
          </div>
          <div class="send-delay-grid">
            <v-text-field
              v-model.number="sendDelayMinSeconds"
              type="number"
              label="Delay từ (giây)"
              min="10"
              variant="outlined"
            />
            <v-text-field
              v-model.number="sendDelayMaxSeconds"
              type="number"
              label="Delay đến (giây)"
              min="10"
              variant="outlined"
            />
            <v-text-field
              v-model="sendStopDate"
              type="date"
              label="Ngày dừng"
              variant="outlined"
            />
            <v-text-field
              v-model="sendStopTime"
              type="time"
              label="Giờ dừng"
              variant="outlined"
            />
          </div>
          <v-checkbox
            v-model="sendRepeat"
            label="Lặp lại danh sách nhóm tới khi đến giờ dừng"
            density="compact"
            hide-details
          />
          <v-text-field
            v-if="sendRepeat"
            v-model.number="sendRepeatEveryMinutes"
            type="number"
            label="Nghỉ giữa mỗi vòng lặp (phút)"
            min="1"
            variant="outlined"
            class="mt-3"
          />
          <div class="text-caption text-medium-emphasis">
            Sẽ gửi tới {{ sendTargetIds.length }} nhóm đang chọn. Delay mỗi nhóm: {{ delayPreview }}. Ảnh kèm: {{ sendImageCount }}. Đóng giao diện vẫn chạy.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="sendDialog = false">Hủy</v-btn>
          <v-btn color="primary" variant="outlined" :loading="actionLoading" :disabled="!canSaveGroupSend" @click="saveGroupSend(false)">
            Lưu job
          </v-btn>
          <v-btn color="primary" :loading="actionLoading" :disabled="!canSaveGroupSend" @click="saveGroupSend(true)">
            {{ editingJobId ? 'Lưu + start' : 'Lưu + chạy' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="serviceDialog" max-width="640" scrollable>
      <v-card>
        <v-card-title>{{ editingServiceJobId ? 'Sửa auto dịch vụ MXHCare' : 'Auto gửi dịch vụ MXHCare' }}</v-card-title>
        <v-card-text class="group-send-form">
          <v-alert type="info" variant="tonal" density="compact">
            Job lấy danh sách dịch vụ từ API MXHCare, gom theo phân loại rồi mỗi vòng gửi phân loại kế tiếp vào nhóm đã chọn.
          </v-alert>
          <div class="text-body-2">
            Nhóm nhận: <b>{{ sendTargetIds.length }}</b>. Nick: <b>{{ selectedAccountName }}</b>.
          </div>
          <div class="send-delay-grid service-delay-grid">
            <v-text-field
              v-model.number="serviceDelayMinSeconds"
              type="number"
              label="Delay từ (giây)"
              min="10"
              variant="outlined"
            />
            <v-text-field
              v-model.number="serviceDelayMaxSeconds"
              type="number"
              label="Delay đến (giây)"
              min="10"
              variant="outlined"
            />
            <v-text-field
              v-model.number="serviceRepeatEveryMinutes"
              type="number"
              label="Mỗi vòng (phút)"
              min="1"
              variant="outlined"
            />
          </div>
          <div class="send-delay-grid">
            <v-text-field
              v-model="serviceStopDate"
              type="date"
              label="Ngày dừng"
              variant="outlined"
            />
            <v-text-field
              v-model="serviceStopTime"
              type="time"
              label="Giờ dừng"
              variant="outlined"
            />
          </div>
          <div class="text-caption text-medium-emphasis">
            Delay giữa nhóm: {{ serviceDelayPreview }}. Mỗi {{ serviceRepeatEveryMinutes || 60 }} phút gửi category tiếp theo. Đóng giao diện vẫn chạy.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="serviceDialog = false">Hủy</v-btn>
          <v-btn color="primary" variant="outlined" :loading="actionLoading" :disabled="!canSaveServiceJob" @click="saveServiceJob(false)">
            Lưu job
          </v-btn>
          <v-btn color="primary" :loading="actionLoading" :disabled="!canSaveServiceJob" @click="saveServiceJob(true)">
            {{ editingServiceJobId ? 'Lưu + start' : 'Lưu + chạy' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

      <v-dialog v-model="jobDialog" fullscreen scrollable>
      <v-card class="job-monitor-dialog">
        <v-card-title class="d-flex align-center gap-3">
          <span>Theo dõi job gửi nhóm</span>
          <v-chip size="small" color="primary" variant="tonal">{{ selectedAccountName }}</v-chip>
          <v-spacer />
          <v-btn variant="text" prepend-icon="mdi-refresh" @click="refreshGroupSendJobs">Tải lại</v-btn>
          <v-btn icon="mdi-close" variant="text" @click="jobDialog = false" />
        </v-card-title>
        <v-card-text class="job-monitor-body">
          <div class="job-monitor-stats mb-4">
            <v-card variant="tonal" class="pa-3">
              <div class="text-caption">Đang chạy</div>
              <div class="text-h5">{{ runningJobs.length }}</div>
            </v-card>
            <v-card variant="tonal" class="pa-3">
              <div class="text-caption">Đang chờ</div>
              <div class="text-h5">{{ queuedJobs.length }}</div>
            </v-card>
            <v-card variant="tonal" class="pa-3">
              <div class="text-caption">Đã xong</div>
              <div class="text-h5">{{ completedJobs.length }}</div>
            </v-card>
            <v-card variant="tonal" class="pa-3">
              <div class="text-caption">Lỗi/Dừng</div>
              <div class="text-h5">{{ failedJobs.length }}</div>
            </v-card>
          </div>

          <div class="job-monitor-list">
            <div v-if="!groupSendJobs.length" class="text-medium-emphasis">Chưa có job gửi nào.</div>
            <div v-else class="job-monitor-grid">
              <v-card
                v-for="job in groupSendJobs"
                :key="job.id"
                variant="outlined"
                class="pa-3"
              >
              <div class="d-flex align-center gap-3 mb-3">
                <v-chip size="small" :color="jobStateColor(job.state, job.lastError)" variant="tonal">
                  {{ jobStateLabel(job) }}
                </v-chip>
                <v-chip size="small" :color="job.sourceType === 'mxhcare_services' ? 'info' : 'secondary'" variant="tonal">
                  {{ jobTypeLabel(job) }}
                </v-chip>
                <div class="text-caption text-medium-emphasis">
                  {{ job.accountName || selectedAccountName }} · job {{ shortId(job.id) }} · nick {{ shortId(job.accountId) }}
                </div>
                <div class="font-weight-medium">{{ job.sent }}/{{ job.groupIds?.length ?? 0 }} đã gửi</div>
                <div class="text-medium-emphasis">{{ job.failed }} lỗi · {{ job.cycles }} vòng</div>
                <div class="text-medium-emphasis">{{ jobDelayLabel(job) }}</div>
                <div v-if="job.sourceType === 'mxhcare_services'" class="text-medium-emphasis">
                  Category cuối: {{ job.serviceLastCategory || '—' }}
                </div>
                <v-spacer />
                <v-btn
                  v-if="job.state === 'queued' || job.state === 'running'"
                  size="small"
                  color="error"
                  variant="outlined"
                  :loading="actionLoading"
                  @click="stopJob(job.id)"
                >
                  Dừng
                </v-btn>
                <template v-else>
                  <v-btn size="small" color="primary" variant="outlined" :loading="actionLoading" @click="startSavedJob(job.id)">
                    Start
                  </v-btn>
                  <v-btn size="small" variant="outlined" @click="job.sourceType === 'mxhcare_services' ? loadServiceJobToEditor(job) : loadJobToEditor(job)">
                    Sửa
                  </v-btn>
                  <v-btn size="small" color="error" variant="text" :loading="actionLoading" @click="deleteSavedJob(job.id)">
                    Xóa
                  </v-btn>
                </template>
              </div>

              <v-progress-linear
                :model-value="jobProgress(job)"
                height="8"
                rounded
                color="primary"
                class="mb-3"
              />

              <v-alert
                v-if="job.lastError"
                :type="job.state === 'queued' && isDisconnectedJobError(job.lastError) ? 'warning' : 'error'"
                variant="tonal"
                density="compact"
                class="mb-3"
              >
                {{ jobStatusMessage(job) }}
              </v-alert>

              <div class="job-log-list">
                <div v-if="!job.logs?.length" class="text-caption text-medium-emphasis">Chưa có log.</div>
                <div v-for="(log, idx) in job.logs" :key="idx" class="job-log-row">
                  <v-chip size="x-small" :color="log.state === 'sent' ? 'success' : 'error'" variant="tonal">
                    {{ log.state === 'sent' ? 'Đã gửi' : 'Lỗi' }}
                  </v-chip>
                  <span>{{ formatTime(log.at) }}</span>
                  <span>{{ groupLabel(log.groupId) }}</span>
                  <span>{{ log.category || '—' }}</span>
                  <span class="text-error">{{ log.error }}</span>
                </div>
              </div>
              </v-card>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSelectedAccount } from '@/composables/use-selected-account';
import { useGroups, type GroupScanMember } from '@/composables/use-groups';
import QuickMessageSelect from '@/components/chat/QuickMessageSelect.vue';

const { accounts, selectedAccountId, selectAccount, loading: accountLoading } = useSelectedAccount();
const router = useRouter();

// Online = ưu tiên liveStatus (pool sống), fallback status (DB) — khớp logic chuẩn
// app (NickGridCards / ZaloAccountsView). Dùng status DB đơn lẻ sai sau restart.
function acctOnline(item: any): boolean {
  const a = item?.raw ?? item;
  return String(a?.liveStatus || a?.status || '').toLowerCase() === 'connected';
}
const {
  groups, loading,
  scan, scanMembers, groupSendJobs, scanLoading, scanMembersLoading, actionLoading,
  fetchGroups, createScan, fetchScanStatus, fetchScanMembers,
  exportScanMembers, saveScanContacts, uploadGroupSendImages, createGroupSendJob, fetchGroupSendJobs,
  stopGroupSendJob, startGroupSendJob, updateGroupSendJob, deleteGroupSendJob,
} = useGroups();

type Phase = 'pick' | 'scanning' | 'roster';
const phase = ref<Phase>('pick');
const startMode = ref<'all' | 'selected' | null>(null);

const search = ref('');
const selectedIds = reactive(new Set<string>());

const memberSearch = ref('');
const friendFilter = ref<'all' | 'friend' | 'stranger'>('all');
const sendDialog = ref(false);
const sendMessage = ref('');
const sendImageFiles = ref<File[]>([]);
const editingImageAttachments = ref<any[]>([]);
const sendImageInput = ref<HTMLInputElement | null>(null);
const sendDelayMinSeconds = ref(30);
const sendDelayMaxSeconds = ref(60);
const sendStopDate = ref('');
const sendStopTime = ref('');
const sendRepeat = ref(false);
const sendRepeatEveryMinutes = ref(60);
const serviceDialog = ref(false);
const editingServiceJobId = ref('');
const serviceDelayMinSeconds = ref(30);
const serviceDelayMaxSeconds = ref(60);
const serviceRepeatEveryMinutes = ref(60);
const serviceStopDate = ref('');
const serviceStopTime = ref('');
const jobDialog = ref(false);
const selectedJobId = ref('');
const editingJobId = ref('');
type SendImagePreview = { key: string; src: string; name?: string; source: 'existing' | 'file'; index: number };
const imagePreviews = ref<SendImagePreview[]>([]);
let imageObjectUrls: string[] = [];

const snack = reactive({ show: false, message: '', color: 'success' });
function notify(message: string, color = 'success') {
  snack.message = message;
  snack.color = color;
  snack.show = true;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

/* ── group list helpers ── */
function groupName(g: any): string {
  return g.name || g.groupName || 'Nhóm không tên';
}
function isCommunity(g: any): boolean {
  return g.type === 'community' || g.isCommunity === true;
}
const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return groups.value;
  return groups.value.filter((g) => groupName(g).toLowerCase().includes(q));
});
const allFilteredSelected = computed(
  () => filteredGroups.value.length > 0 && filteredGroups.value.every((g) => selectedIds.has(g.id)),
);
const estimatedMembers = computed(() =>
  groups.value
    .filter((g) => selectedIds.has(g.id))
    .reduce((sum, g) => sum + (g.totalMember ?? g.totalMembers ?? 0), 0),
);

function toggleGroup(id: string) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}
function toggleSelectAll() {
  if (allFilteredSelected.value) {
    filteredGroups.value.forEach((g) => selectedIds.delete(g.id));
  } else {
    filteredGroups.value.forEach((g) => selectedIds.add(g.id));
  }
}
function selectAllGroups() {
  groups.value.forEach((g) => selectedIds.add(g.id));
}

function openNewSendDialog() {
  editingJobId.value = '';
  editingImageAttachments.value = [];
  sendImageFiles.value = [];
  sendDelayMinSeconds.value = 30;
  sendDelayMaxSeconds.value = 60;
  sendStopDate.value = '';
  sendStopTime.value = '';
  sendDialog.value = true;
}

function openNewServiceDialog() {
  editingServiceJobId.value = '';
  serviceDelayMinSeconds.value = 30;
  serviceDelayMaxSeconds.value = 60;
  serviceRepeatEveryMinutes.value = 60;
  serviceStopDate.value = '';
  serviceStopTime.value = '';
  serviceDialog.value = true;
}

function revokeImageObjectUrls() {
  for (const url of imageObjectUrls) URL.revokeObjectURL(url);
  imageObjectUrls = [];
}

function rebuildImagePreviews() {
  revokeImageObjectUrls();
  const existing = editingImageAttachments.value.map((image: any, index: number) => ({
    key: `existing-${index}-${image?.name ?? 'image'}`,
    src: image?.url || (image?.data ? `data:${image?.mimeType || 'image/jpeg'};base64,${image.data}` : ''),
    name: image?.name,
    source: 'existing' as const,
    index,
  }));
  const files = sendImageFiles.value.map((file, index) => {
    const src = URL.createObjectURL(file);
    imageObjectUrls.push(src);
    return { key: `file-${index}-${file.name}-${file.size}`, src, name: file.name, source: 'file' as const, index };
  });
  imagePreviews.value = [...existing, ...files];
}

function onSelectSendImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  if (files.length > 5) notify('Tối đa 5 ảnh', 'error');
  editingImageAttachments.value = [];
  sendImageFiles.value = files.slice(0, 5);
}

function removeSendImage(image: SendImagePreview) {
  if (image.source === 'existing') {
    editingImageAttachments.value.splice(image.index, 1);
    editingImageAttachments.value = [...editingImageAttachments.value];
  } else {
    sendImageFiles.value.splice(image.index, 1);
    sendImageFiles.value = [...sendImageFiles.value];
    if (!sendImageFiles.value.length && sendImageInput.value) sendImageInput.value.value = '';
  }
}

watch([sendImageFiles, editingImageAttachments], rebuildImagePreviews, { deep: true });

/* ── avatar helpers (theme-independent, deterministic) ── */
const AVATAR_COLORS = ['#7c5cff', '#12b76a', '#f5a524', '#1786be', '#f04438', '#5bb8e5'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function setStopFields(value?: string | null) {
  if (!value) {
    sendStopDate.value = '';
    sendStopTime.value = '';
    return;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return;
  sendStopDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  sendStopTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function stopAtIso(): string | undefined {
  if (!sendStopDate.value) return undefined;
  const local = new Date(`${sendStopDate.value}T${sendStopTime.value || '23:59'}`);
  if (Number.isNaN(local.getTime())) return undefined;
  return local.toISOString();
}

function setServiceStopFields(value?: string | null) {
  if (!value) {
    serviceStopDate.value = '';
    serviceStopTime.value = '';
    return;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return;
  serviceStopDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  serviceStopTime.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function serviceStopAtIso(): string | undefined {
  if (!serviceStopDate.value) return undefined;
  const local = new Date(`${serviceStopDate.value}T${serviceStopTime.value || '23:59'}`);
  if (Number.isNaN(local.getTime())) return undefined;
  return local.toISOString();
}

/* ── scan flow ── */
async function startScan(all: boolean) {
  const acct = selectedAccountId.value;
  if (!acct) {
    notify('Chưa chọn tài khoản Zalo', 'error');
    return;
  }
  startMode.value = all ? 'all' : 'selected';
  const payload = all ? { all: true } : { groupIds: Array.from(selectedIds) };
  const created = await createScan(acct, payload);
  if (!created) {
    notify('Không bắt đầu được phiên quét', 'error');
    startMode.value = null;
    return;
  }
  phase.value = 'scanning';
  pollScan();
}

const POLL_MS = 2000;
async function pollScan() {
  const acct = selectedAccountId.value;
  const scanId = scan.value?.id;
  if (!acct || !scanId) return;
  const snapshot = await fetchScanStatus(acct, scanId);
  const state = snapshot?.state;
  if (state === 'completed' || state === 'partial' || state === 'failed') {
    await loadMembers();
    phase.value = 'roster';
    startMode.value = null;
    return;
  }
  // still pending/running → keep polling
  pollTimer = setTimeout(pollScan, POLL_MS);
}

async function loadMembers() {
  const acct = selectedAccountId.value;
  const scanId = scan.value?.id;
  if (!acct || !scanId) return;
  const opts =
    friendFilter.value === 'all'
      ? {}
      : { isFriend: friendFilter.value === 'friend' };
  await fetchScanMembers(acct, scanId, opts);
}

function onFilterChange() {
  loadMembers();
}

const memberHeaders = [
  { title: 'Thành viên', key: 'member', sortable: false },
  { title: 'Zalo UID', key: 'memberUid' },
  { title: 'Trạng thái', key: 'isFriend' },
  { title: 'Vai trò', key: 'isAdmin' },
  { title: 'Lưu lúc', key: 'harvestedAt', align: 'end' as const },
];

// Client-side fallback filter (backend already filters via isFriend param, but
// keeps the segment instant when toggling before the refetch resolves).
const filteredMembers = computed<GroupScanMember[]>(() => {
  if (friendFilter.value === 'all') return scanMembers.value;
  const want = friendFilter.value === 'friend';
  return scanMembers.value.filter((m) => m.isFriend === want);
});
const totalMembers = computed(() => scan.value?.memberCount ?? scanMembers.value.length);
const friendCount = computed(
  () => scan.value?.friendCount ?? scanMembers.value.filter((m) => m.isFriend).length,
);
const scanProgress = computed(() => {
  const total = scan.value?.totalGroups ?? 0;
  if (!total) return 0;
  return Math.round(((scan.value?.scannedGroups ?? 0) / total) * 100);
});
const scannedGroupIds = computed(() => (
  Array.isArray(scan.value?.groupIds) ? (scan.value!.groupIds as unknown[]).map(String) : []
));
const sendTargetIds = computed(() => (
  selectedIds.size ? Array.from(selectedIds) : scannedGroupIds.value
));
const sendImageCount = computed(() => sendImageFiles.value.length || editingImageAttachments.value.length);
const delayRange = computed(() => ({
  min: Math.max(10, Math.round(Number(sendDelayMinSeconds.value) || 10)),
  max: Math.max(10, Math.round(Number(sendDelayMaxSeconds.value) || 10)),
}));
const delayRangeValid = computed(() => delayRange.value.max >= delayRange.value.min);
const delayPreview = computed(() => (
  delayRange.value.min === delayRange.value.max
    ? `${delayRange.value.min} giây`
    : `${delayRange.value.min}-${delayRange.value.max} giây`
));
const serviceDelayRange = computed(() => ({
  min: Math.max(10, Math.round(Number(serviceDelayMinSeconds.value) || 10)),
  max: Math.max(10, Math.round(Number(serviceDelayMaxSeconds.value) || 10)),
}));
const serviceDelayValid = computed(() => serviceDelayRange.value.max >= serviceDelayRange.value.min);
const serviceDelayPreview = computed(() => (
  serviceDelayRange.value.min === serviceDelayRange.value.max
    ? `${serviceDelayRange.value.min} giây`
    : `${serviceDelayRange.value.min}-${serviceDelayRange.value.max} giây`
));
const canSaveGroupSend = computed(() => (
  delayRangeValid.value &&
  sendTargetIds.value.length > 0 &&
  (sendMessage.value.trim().length > 0 || sendImageCount.value > 0)
));
const canSaveServiceJob = computed(() => serviceDelayValid.value && sendTargetIds.value.length > 0);
const selectedAccountName = computed(() => accounts.value.find((account: any) => account.id === selectedAccountId.value)?.displayName ?? 'Chưa chọn nick');
const runningJobs = computed(() => groupSendJobs.value.filter((job: any) => job.state === 'running'));
const queuedJobs = computed(() => groupSendJobs.value.filter((job: any) => job.state === 'queued'));
const completedJobs = computed(() => groupSendJobs.value.filter((job: any) => job.state === 'completed'));
const failedJobs = computed(() => groupSendJobs.value.filter((job: any) => job.state === 'failed' || job.state === 'stopped'));

function memberFilterParam(): boolean | undefined {
  if (friendFilter.value === 'friend') return true;
  if (friendFilter.value === 'stranger') return false;
  return undefined;
}

async function saveContacts() {
  const acct = selectedAccountId.value;
  const scanId = scan.value?.id;
  if (!acct || !scanId) return;
  const res = await saveScanContacts(acct, scanId, { isFriend: memberFilterParam() });
  if (!res) return notify('Lưu khách hàng thất bại', 'error');
  notify(`Đã lưu ${res.total} người: mới ${res.created}, cập nhật ${res.updated}`);
}

function openSavedMembers() {
  if (!selectedAccountId.value) return;
  const isFriend = memberFilterParam();
  router.push({
    path: '/marketing/group-audience',
    query: {
      accountId: selectedAccountId.value,
      ...(typeof isFriend === 'boolean' ? { isFriend: String(isFriend) } : {}),
    },
  });
}

function exportMembers() {
  const acct = selectedAccountId.value;
  const scanId = scan.value?.id;
  if (!acct || !scanId) return;
  exportScanMembers(acct, scanId, { isFriend: memberFilterParam() });
}

async function buildGroupSendImages(accountId: string) {
  if (!sendImageFiles.value.length) return editingImageAttachments.value;
  if (sendImageFiles.value.length > 5) {
    notify('Tối đa 5 ảnh', 'error');
    return null;
  }
  for (const file of sendImageFiles.value) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      notify(`Không hỗ trợ file: ${file.name}`, 'error');
      return null;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify(`Ảnh quá lớn: ${file.name}`, 'error');
      return null;
    }
  }
  const uploaded = await uploadGroupSendImages(accountId, sendImageFiles.value);
  if (!uploaded) notify('Upload ảnh thất bại', 'error');
  return uploaded;
}

async function saveGroupSend(autoStart: boolean) {
  const acct = selectedAccountId.value;
  if (!acct) return;
  if (!delayRangeValid.value) {
    notify('Delay đến phải lớn hơn hoặc bằng delay từ', 'error');
    return;
  }
  if (!canSaveGroupSend.value) return;
  const stopAt = stopAtIso();
  if ((sendStopDate.value || sendStopTime.value) && !stopAt) {
    notify('Ngày dừng chưa hợp lệ', 'error');
    return;
  }
  if (sendRepeat.value && !stopAt) {
    notify('Lặp cần chọn giờ dừng', 'error');
    return;
  }
  const imageAttachments = await buildGroupSendImages(acct);
  if (!imageAttachments) return;
  const payload = {
    groupIds: sendTargetIds.value,
    message: sendMessage.value,
    imageAttachments,
    delaySeconds: delayRange.value.min,
    delayMinSeconds: delayRange.value.min,
    delayMaxSeconds: delayRange.value.max,
    stopAt,
    repeat: sendRepeat.value,
    repeatEveryMinutes: sendRepeatEveryMinutes.value,
    autoStart,
  };
  if (editingJobId.value) {
    const updated = await updateGroupSendJob(acct, editingJobId.value, payload);
    if (!updated) return notify('Lưu job thất bại', 'error');
    if (autoStart) await startGroupSendJob(acct, editingJobId.value);
    editingJobId.value = '';
    sendDialog.value = false;
    jobDialog.value = true;
    notify(autoStart ? 'Đã lưu và start job' : 'Đã lưu job');
    return;
  }
  const job = await createGroupSendJob(acct, payload);
  if (!job) return notify('Tạo job gửi thất bại', 'error');
  selectedJobId.value = job.id;
  sendDialog.value = false;
  jobDialog.value = true;
  notify(autoStart ? `Đã tạo và chạy job: ${job.id}` : `Đã lưu job: ${job.id}`);
  await refreshGroupSendJobs();
}

async function saveServiceJob(autoStart: boolean) {
  const acct = selectedAccountId.value;
  if (!acct) return;
  if (!serviceDelayValid.value) {
    notify('Delay đến phải lớn hơn hoặc bằng delay từ', 'error');
    return;
  }
  const stopAt = serviceStopAtIso();
  if ((serviceStopDate.value || serviceStopTime.value) && !stopAt) {
    notify('Ngày dừng chưa hợp lệ', 'error');
    return;
  }
  const payload = {
    sourceType: 'mxhcare_services',
    groupIds: sendTargetIds.value,
    message: '',
    delaySeconds: serviceDelayRange.value.min,
    delayMinSeconds: serviceDelayRange.value.min,
    delayMaxSeconds: serviceDelayRange.value.max,
    stopAt,
    repeat: true,
    repeatEveryMinutes: Math.max(1, Math.round(Number(serviceRepeatEveryMinutes.value) || 60)),
    autoStart,
  };
  if (editingServiceJobId.value) {
    const updated = await updateGroupSendJob(acct, editingServiceJobId.value, payload);
    if (!updated) return notify('Lưu job dịch vụ thất bại', 'error');
    if (autoStart) await startGroupSendJob(acct, editingServiceJobId.value);
    editingServiceJobId.value = '';
    serviceDialog.value = false;
    jobDialog.value = true;
    notify(autoStart ? 'Đã lưu và start auto dịch vụ' : 'Đã lưu auto dịch vụ');
    return;
  }
  const job = await createGroupSendJob(acct, payload);
  if (!job) return notify('Tạo auto dịch vụ thất bại', 'error');
  selectedJobId.value = job.id;
  serviceDialog.value = false;
  jobDialog.value = true;
  notify(autoStart ? `Đã tạo và chạy auto dịch vụ: ${job.id}` : `Đã lưu auto dịch vụ: ${job.id}`);
  await refreshGroupSendJobs();
}

async function refreshGroupSendJobs() {
  const acct = selectedAccountId.value;
  if (acct) await fetchGroupSendJobs(acct);
}

function groupLabel(groupId: string): string {
  const group = groups.value.find((g) => g.id === groupId);
  return group ? groupName(group) : groupId;
}

function shortId(id?: string): string {
  return id ? id.slice(0, 8) : '';
}

function jobTypeLabel(job: any): string {
  return job.sourceType === 'mxhcare_services' ? 'Auto dịch vụ' : 'Tin thường';
}

function jobProgress(job: any): number {
  const total = Math.max(1, job.groupIds?.length ?? 1);
  return Math.min(100, Math.round(((job.sent + job.failed) / total) * 100));
}

function jobDelayLabel(job: any): string {
  const min = Math.max(10, Math.round((job.delayMinMs ?? job.delayMs ?? 30000) / 1000));
  const max = Math.max(min, Math.round((job.delayMaxMs ?? job.delayMs ?? 30000) / 1000));
  const delay = min === max ? `Delay ${min}s` : `Delay ${min}-${max}s`;
  if (job.sourceType !== 'mxhcare_services') return delay;
  return `${delay} · mỗi ${Math.max(1, Math.round((job.repeatPauseMs ?? 3600000) / 60000))} phút`;
}

async function openJobsMonitor() {
  await refreshGroupSendJobs();
  selectedJobId.value = groupSendJobs.value[0]?.id ?? '';
  jobDialog.value = true;
}

async function stopJob(jobId: string) {
  const acct = selectedAccountId.value;
  if (!acct) return;
  const job = await stopGroupSendJob(acct, jobId);
  if (!job) return notify('Dừng job thất bại', 'error');
  notify('Đã yêu cầu dừng job', 'warning');
}

function loadJobToEditor(job: any) {
  editingJobId.value = job.id;
  selectedIds.clear();
  (job.groupIds ?? []).forEach((id: string) => selectedIds.add(id));
  sendMessage.value = job.message ?? '';
  editingImageAttachments.value = Array.isArray(job.imageAttachments) ? job.imageAttachments : [];
  sendImageFiles.value = [];
  sendDelayMinSeconds.value = Math.max(10, Math.round((job.delayMinMs ?? job.delayMs ?? 30000) / 1000));
  sendDelayMaxSeconds.value = Math.max(sendDelayMinSeconds.value, Math.round((job.delayMaxMs ?? job.delayMs ?? 30000) / 1000));
  setStopFields(job.stopAt);
  sendRepeat.value = Boolean(job.repeat);
  sendRepeatEveryMinutes.value = Math.max(1, Math.round((job.repeatPauseMs ?? 3600000) / 60000));
  jobDialog.value = false;
  sendDialog.value = true;
}

function loadServiceJobToEditor(job: any) {
  editingServiceJobId.value = job.id;
  selectedIds.clear();
  (job.groupIds ?? []).forEach((id: string) => selectedIds.add(id));
  serviceDelayMinSeconds.value = Math.max(10, Math.round((job.delayMinMs ?? job.delayMs ?? 30000) / 1000));
  serviceDelayMaxSeconds.value = Math.max(serviceDelayMinSeconds.value, Math.round((job.delayMaxMs ?? job.delayMs ?? 30000) / 1000));
  serviceRepeatEveryMinutes.value = Math.max(1, Math.round((job.repeatPauseMs ?? 3600000) / 60000));
  setServiceStopFields(job.stopAt);
  jobDialog.value = false;
  serviceDialog.value = true;
}

async function startSavedJob(jobId: string) {
  const acct = selectedAccountId.value;
  if (!acct) return;
  const job = await startGroupSendJob(acct, jobId);
  if (!job) return notify('Start job thất bại', 'error');
  notify('Đã start job', 'success');
  await refreshGroupSendJobs();
}

async function deleteSavedJob(jobId: string) {
  const acct = selectedAccountId.value;
  if (!acct) return;
  const ok = await deleteGroupSendJob(acct, jobId);
  notify(ok ? 'Đã xóa job' : 'Xóa job thất bại', ok ? 'success' : 'error');
}

function isDisconnectedJobError(error: string): boolean {
  return error.includes('Zalo account not connected');
}

function jobStateLabel(job: any): string {
  if (job.state === 'queued' && isDisconnectedJobError(String(job.lastError ?? ''))) return 'Chờ nick kết nối';
  if (job.state === 'queued') return 'Đang chờ';
  if (job.state === 'running') return 'Đang chạy';
  if (job.state === 'completed') return 'Hoàn tất';
  if (job.state === 'stopped') return 'Đã dừng';
  if (job.state === 'failed') return 'Lỗi';
  return job.state;
}

function jobStatusMessage(job: any): string {
  if (job.state === 'queued' && isDisconnectedJobError(String(job.lastError ?? ''))) {
    return 'Nick đang mất kết nối. Job giữ lại và tự thử lại sau 30 giây khi nick kết nối.';
  }
  return String(job.lastError);
}

function jobStateColor(state: string, lastError = ''): string {
  if (state === 'queued' && isDisconnectedJobError(lastError)) return 'warning';
  if (state === 'completed') return 'success';
  if (state === 'failed') return 'error';
  if (state === 'stopped') return 'warning';
  return 'primary';
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
function backToPick() {
  stopPolling();
  phase.value = 'pick';
  scan.value = null;
  scanMembers.value = [];
  selectedIds.clear();
  friendFilter.value = 'all';
}

async function onAccountChange(id: string) {
  selectAccount(id);
  backToPick();
  groups.value = [];
  groupSendJobs.value = [];
  if (id) {
    await fetchGroups(id);
    await fetchGroupSendJobs(id);
  }
}

onMounted(() => {
  if (selectedAccountId.value) {
    fetchGroups(selectedAccountId.value);
    fetchGroupSendJobs(selectedAccountId.value);
  }
});
onBeforeUnmount(() => {
  stopPolling();
  revokeImageObjectUrls();
});
</script>

<style scoped>
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.gap-3 { gap: 12px; }
.gap-4 { gap: 16px; }
.border-b { border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.border-t { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.group-scan-body {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 148px);
  min-height: 0;
  overflow: hidden;
}
.pick-card {
  height: 100%;
  min-height: 0;
}
.roster-card {
  height: 100%;
  min-height: 0;
}
.roster-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.group-list-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.job-monitor-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 12px;
}
.job-monitor-dialog {
  height: 100%;
  min-height: 0;
}
.job-monitor-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.job-monitor-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.job-monitor-grid {
  display: grid;
  gap: 12px;
}
.group-send-dialog {
  max-height: min(760px, 92vh);
}
.group-send-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.send-delay-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.service-delay-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.image-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hidden-file-input {
  display: none;
}
.image-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}
.image-preview-item {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-surface-variant), 0.25);
}
.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.image-preview-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 8px;
  text-align: center;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.image-preview-remove {
  position: absolute;
  top: 5px;
  right: 5px;
}
.send-job-row {
  display: grid;
  grid-template-columns: 110px 120px 70px 70px minmax(220px, 1fr);
  gap: 12px;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.send-job-row:last-child {
  border-bottom: 0;
}
.job-log-list {
  max-height: 420px;
  overflow: auto;
}
.job-log-row {
  display: grid;
  grid-template-columns: 70px 90px minmax(180px, 1fr) minmax(180px, 1fr) minmax(160px, 1fr);
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.sticky-bar {
  position: sticky;
  bottom: 0;
  background: rgb(var(--v-theme-surface));
  z-index: 1;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 760px) {
  .stat-grid { grid-template-columns: 1fr; }
  .job-monitor-stats { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
  .send-delay-grid { grid-template-columns: 1fr; }
  .image-preview-grid { grid-template-columns: repeat(3, 1fr); }
}
</style>
