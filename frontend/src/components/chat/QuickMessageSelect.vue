<template>
  <div class="quick-message-select">
    <v-select
      v-model="selectedId"
      :items="templates"
      item-title="name"
      item-value="id"
      label="Tin nhắn nhanh"
      variant="outlined"
      density="compact"
      hide-details
      clearable
      :loading="loading"
      @update:model-value="applySelected"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps">
          <v-list-item-subtitle>{{ preview(item) }}</v-list-item-subtitle>
        </v-list-item>
      </template>
    </v-select>
    <v-btn
      variant="outlined"
      prepend-icon="mdi-content-save-outline"
      :loading="saving"
      :disabled="!currentText"
      @click="saveCurrent"
    >
      Lưu tin này
    </v-btn>
    <v-btn icon="mdi-refresh" variant="text" :loading="loading" title="Tải lại mẫu" @click="loadTemplates" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMessageTemplates, type MessageTemplate } from '@/composables/use-message-templates';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const selectedId = ref<string | null>(null);
const toast = useToast();
const { templates, loading, saving, fetchTemplates, createTemplate, trackUse } = useMessageTemplates();
const currentText = computed(() => props.modelValue.trim());

function preview(value: MessageTemplate | { raw?: MessageTemplate }): string {
  const template = ((value as { raw?: MessageTemplate }).raw ?? value) as MessageTemplate;
  return (template?.contentRich?.text || template?.content || '').replace(/\s+/g, ' ').slice(0, 120);
}

function defaultName(content: string): string {
  return content.split(/\r?\n/).find(Boolean)?.slice(0, 60) || 'Tin nhắn nhanh';
}

async function loadTemplates() {
  await fetchTemplates({ includeArchived: false });
}

async function applySelected(id: string | null) {
  if (!id) return;
  const template = templates.value.find((item) => item.id === id);
  if (!template) return;
  emit('update:modelValue', template.contentRich?.text || template.content || '');
  await trackUse(id);
}

async function saveCurrent() {
  const content = currentText.value;
  if (!content) return;
  const exists = templates.value.find((item) => (item.contentRich?.text || item.content || '').trim() === content);
  if (exists) {
    selectedId.value = exists.id;
    toast.warning('Tin này đã có trong mẫu');
    return;
  }
  const name = window.prompt('Tên tin nhắn nhanh', defaultName(content));
  if (name === null) return;
  const saved = await createTemplate({
    name: name.trim() || defaultName(content),
    content,
    contentRich: { text: content, styles: [] },
    category: 'quick',
    visibility: 'private',
  });
  templates.value.unshift(saved);
  selectedId.value = saved.id;
  toast.success('Đã lưu tin nhắn nhanh');
}

onMounted(loadTemplates);
</script>

<style scoped>
.quick-message-select {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}
@media (max-width: 700px) {
  .quick-message-select {
    grid-template-columns: 1fr;
  }
}
</style>
