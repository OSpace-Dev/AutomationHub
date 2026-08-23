<script setup lang="ts">
import { Info, Save, Sparkles } from "lucide-vue-next";
import { computed, watch } from "vue";
import { useReportsData } from "../../useReportsData";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const {
  reportDefinition,
  reportDefinitionLoading,
  reportDefinitionSaving,
  reportDefinitionError,
  reportDefinitionNotice,
  refreshReportDefinition,
  updateReportPrompt
} = useReportsData();
const promptTemplate = computed({
  get: () => reportDefinition.value?.prompt_template ?? "",
  set: (value: string) => {
    if (reportDefinition.value) reportDefinition.value.prompt_template = value;
  }
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reportDefinitionNotice.value = "";
      void refreshReportDefinition();
    }
  }
);

async function savePrompt() {
  if (await updateReportPrompt(promptTemplate.value)) emit("update:modelValue", false);
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="日报提示词设置"
    size="min(680px, 100%)"
    class="admin-drawer prompt-drawer"
    append-to-body
    :close-on-click-modal="!reportDefinitionSaving"
    :close-on-press-escape="!reportDefinitionSaving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="drawer-form prompt-drawer-form">
      <div class="drawer-intro">
        <span class="drawer-icon"><Sparkles :size="18" /></span>
        <div>
          <strong>调整日报分析方向</strong>
          <span>这里的内容会作为日报生成的系统提示词，保存后对后续生成任务生效。</span>
        </div>
      </div>
      <div v-if="reportDefinitionLoading" class="loading-state compact" aria-live="polite">
        <span>正在读取提示词</span>
      </div>
      <template v-else>
        <div v-if="reportDefinitionError" class="inline-error" role="alert">{{ reportDefinitionError }}</div>
        <template v-if="reportDefinition">
          <label class="prompt-field">
            <span>提示词内容</span>
            <el-input
              v-model="promptTemplate"
              type="textarea"
              :rows="14"
              maxlength="12000"
              show-word-limit
              resize="vertical"
              placeholder="请输入日报分析提示词"
            />
          </label>
          <p class="prompt-form-help">
            <Info :size="14" aria-hidden="true" /><span
              >建议明确分析重点、语气和禁止事项。系统会继续追加结构化输出要求，不需要在这里重复编写 JSON 格式。</span
            >
          </p>
          <div v-if="reportDefinitionNotice" class="inline-success" role="status">
            {{ reportDefinitionNotice }}
          </div>
        </template>
      </template>
    </div>
    <template #footer>
      <div class="drawer-footer">
        <el-button :disabled="reportDefinitionSaving" @click="emit('update:modelValue', false)">取消</el-button>
        <el-button
          type="primary"
          :loading="reportDefinitionSaving"
          :disabled="reportDefinitionLoading || !reportDefinition || !promptTemplate.trim()"
          @click="savePrompt"
        >
          <Save v-if="!reportDefinitionSaving" :size="15" />保存提示词
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>
