<script setup lang="ts">
import { ref } from "vue";
import { Play, Sparkles } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { useReportsData } from "../../useReportsData";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; created: [] }>();
const selectedRunId = ref("");
const {
  reportGenerationDate,
  reportRuns,
  defaultProviderConfigured,
  reportActionLoading,
  reportActionKind,
  refreshReportRuns,
  createReport,
  formatReportTime
} = useReportsData();

async function changeGenerationDate() {
  selectedRunId.value = "";
  await refreshReportRuns();
}
async function submitReport() {
  if (await createReport(selectedRunId.value)) {
    emit("update:modelValue", false);
    emit("created");
  }
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="生成日报"
    size="min(560px, 100%)"
    class="admin-drawer"
    append-to-body
    :close-on-click-modal="!reportActionLoading"
    :close-on-press-escape="!reportActionLoading"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="drawer-form">
      <div class="drawer-intro">
        <span class="drawer-icon"><Sparkles :size="18" /></span>
        <div><strong>从采集批次生成日报</strong><span>选择业务日期和已完成批次，生成后自动打开详情。</span></div>
      </div>
      <label
        >业务日期<el-date-picker
          v-model="reportGenerationDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          @change="changeGenerationDate"
      /></label>
      <label
        >采集批次<el-select v-model="selectedRunId" placeholder="选择采集批次" filterable>
          <el-option
            v-for="run in reportRuns"
            :key="run.id"
            :label="`${formatReportTime(run.createdAt)} · ${run.itemCount} 项目`"
            :value="run.id"
          /> </el-select
      ></label>
      <div v-if="!defaultProviderConfigured" class="inline-error">
        <span>尚未配置可用的默认模型。</span><RouterLink to="/settings/models">前往模型配置</RouterLink>
      </div>
    </div>
    <template #footer
      ><div class="drawer-footer">
        <el-button :disabled="reportActionLoading" @click="emit('update:modelValue', false)">取消</el-button
        ><el-button
          type="primary"
          :loading="reportActionKind === 'create'"
          :disabled="!selectedRunId || reportActionLoading || !defaultProviderConfigured"
          @click="submitReport"
          ><Play v-if="reportActionKind !== 'create'" :size="15" />生成日报</el-button
        >
      </div></template
    >
  </el-drawer>
</template>
