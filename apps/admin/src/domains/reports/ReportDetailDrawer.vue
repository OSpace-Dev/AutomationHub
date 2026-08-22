<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Copy, ExternalLink, FileText, Link2, RefreshCw, RotateCcw, Send } from "lucide-vue-next";
import MarkdownContent from "../../components/MarkdownContent.vue";
import ReportInsights from "../../components/ReportInsights.vue";
import { useReportsData } from "../../useReportsData";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const copiedReportId = ref("");
const {
  selectedReport,
  reportDeliveries,
  reportDetailLoading,
  reportActionLoading,
  reportActionKind,
  retryReport,
  sendReport,
  retryDelivery,
  formatReportTime,
  reportStatusLabel,
  deliveryStatusLabel,
  deliveryStatusTone
} = useReportsData();
const sendCommandLabel = computed(() => (reportDeliveries.value.length ? "重新发送日报" : "发送日报"));

async function copyPublicUrl() {
  if (!selectedReport.value?.public_url) return;
  await navigator.clipboard.writeText(selectedReport.value.public_url);
  copiedReportId.value = selectedReport.value.id;
  window.setTimeout(() => {
    if (copiedReportId.value === selectedReport.value?.id) copiedReportId.value = "";
  }, 1800);
}
async function regenerateReport() {
  if (selectedReport.value && (await retryReport(selectedReport.value))) emit("update:modelValue", true);
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="selectedReport ? selectedReport.business_date + ' 日报' : '日报详情'"
    size="min(860px, 100%)"
    class="admin-drawer report-detail-drawer"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="reportDetailLoading" class="loading-state" aria-live="polite">
      <RefreshCw :size="20" class="spinning" /><span>正在读取日报详情</span>
    </div>
    <div v-else-if="selectedReport" class="report-drawer-content">
      <div class="detail-hero report-detail-hero">
        <span class="drawer-icon"><FileText :size="18" /></span>
        <div>
          <strong>{{ selectedReport.provider_name || "等待模型" }} · {{ selectedReport.model || "尚未生成" }}</strong
          ><code>{{ selectedReport.input_item_count }} 个项目 · {{ formatReportTime(selectedReport.created_at) }}</code>
        </div>
        <span class="status" :data-status="selectedReport.status">{{ reportStatusLabel(selectedReport.status) }}</span>
      </div>
      <div class="report-command-bar">
        <div v-if="selectedReport.public_url" class="report-public-link">
          <Link2 :size="16" aria-hidden="true" />
          <div>
            <strong>公开阅读</strong><span>{{ selectedReport.public_url }}</span>
          </div>
        </div>
        <div v-else class="report-public-link is-unavailable">
          <Link2 :size="16" aria-hidden="true" />
          <div><strong>公开链接未配置</strong><span>请检查服务端 PUBLIC_BASE_URL。</span></div>
        </div>
        <div class="report-command-actions">
          <div v-if="selectedReport.public_url" class="report-share-actions" aria-label="公开链接操作">
            <button
              class="icon-button"
              type="button"
              :title="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'"
              :aria-label="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'"
              @click="copyPublicUrl"
            >
              <Check v-if="copiedReportId === selectedReport.id" :size="16" /><Copy v-else :size="16" />
            </button>
            <a class="secondary-button" :href="selectedReport.public_url" target="_blank" rel="noopener noreferrer"
              ><ExternalLink :size="15" /><span>打开公开日报</span></a
            >
          </div>
          <button
            class="secondary-button report-regenerate-button"
            type="button"
            :disabled="
              reportActionLoading || selectedReport.status === 'pending' || selectedReport.status === 'running'
            "
            @click="regenerateReport"
          >
            <RefreshCw v-if="reportActionKind === 'regenerate'" :size="15" class="spinning" /><RotateCcw
              v-else
              :size="15"
            /><span>{{ reportActionKind === "regenerate" ? "提交中" : "重新生成" }}</span>
          </button>
        </div>
      </div>
      <div v-if="selectedReport.status === 'failed'" class="report-failure">
        <strong>生成失败</strong><code>{{ selectedReport.error_code }}</code>
        <p>{{ selectedReport.error_message }}</p>
        <span>确认模型服务状态后，可以重新生成。</span>
      </div>
      <div v-else-if="selectedReport.status !== 'completed'" class="workspace-empty">
        <RefreshCw :size="30" :class="{ spinning: selectedReport.status === 'running' }" /><strong>{{
          reportStatusLabel(selectedReport.status)
        }}</strong
        ><span>页面会自动更新当前日报状态，并保留列表条件。</span>
      </div>
      <div v-else class="report-drawer-scroll">
        <section class="delivery-panel" aria-live="polite">
          <div class="delivery-panel-header">
            <div>
              <span class="eyebrow">TELEGRAM DELIVERY</span>
              <h3>推送状态</h3>
              <p>重新发送会把当前启用目标再次排队；失败目标也可以单独重试。</p>
            </div>
            <button
              class="secondary-button"
              type="button"
              :disabled="reportActionLoading"
              @click="sendReport(selectedReport)"
            >
              <RefreshCw v-if="reportActionKind === 'send'" :size="15" class="spinning" /><Send
                v-else
                :size="15"
              /><span>{{ reportActionKind === "send" ? "提交中" : sendCommandLabel }}</span>
            </button>
          </div>
          <div v-if="!reportDeliveries.length" class="delivery-empty">
            <Send :size="17" /><span>尚未创建发送任务。请先在“通知渠道”中启用 Bot 和 chat 目标。</span>
          </div>
          <div v-else class="delivery-list">
            <div v-for="delivery in reportDeliveries" :key="delivery.id" class="delivery-row">
              <div class="delivery-row-main">
                <strong>{{ delivery.target_name || delivery.chat_id || "Telegram 目标" }}</strong
                ><small
                  >{{ delivery.channel_name || "Telegram Bot"
                  }}<span v-if="delivery.chat_id"> · {{ delivery.chat_id }}</span></small
                >
              </div>
              <span class="status" :data-status="deliveryStatusTone(delivery.status)">{{
                deliveryStatusLabel(delivery.status)
              }}</span>
              <small class="delivery-attempt"
                >第 {{ delivery.attempt_count }} 次尝试<span v-if="delivery.message_count">
                  · {{ delivery.message_count }} 条消息</span
                ></small
              >
              <button
                v-if="delivery.status === 'failed'"
                class="text-button danger-text"
                type="button"
                :disabled="reportActionLoading"
                @click="retryDelivery(delivery)"
              >
                <RefreshCw v-if="reportActionKind === 'retry-delivery'" :size="13" class="spinning" /><RotateCcw
                  v-else
                  :size="13"
                />重试
              </button>
              <span v-if="delivery.last_error" class="delivery-error">{{ delivery.last_error }}</span>
            </div>
          </div>
        </section>
        <div class="report-content">
          <ReportInsights v-if="selectedReport.insights" :insights="selectedReport.insights" /><MarkdownContent
            v-else
            :content="selectedReport.content"
          />
        </div>
      </div>
    </div>
    <template #footer
      ><div class="drawer-footer"><el-button @click="emit('update:modelValue', false)">关闭</el-button></div></template
    >
  </el-drawer>
</template>
