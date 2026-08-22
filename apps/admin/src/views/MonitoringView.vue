<script setup lang="ts">
import { computed, ref } from "vue";
import { Eye, RefreshCw, RotateCcw, Search, Wifi } from "lucide-vue-next";
import PaginationControl from "../components/PaginationControl.vue";
import type { RuntimeLog } from "../admin-models";
import { useAdminData } from "../useAdminData";
const { logs, loading, pagination, changePage, formatTime } = useAdminData();
const keyword = ref("");
const level = ref("");
const selectedLog = ref<RuntimeLog | null>(null);
const detailDrawerOpen = ref(false);
const filteredLogs = computed(() =>
  logs.value.filter(
    (log) =>
      (!level.value || log.level === level.value) &&
      (!keyword.value ||
        `${log.event} ${log.device_id} ${log.message}`.toLowerCase().includes(keyword.value.toLowerCase()))
  )
);
function resetFilters() {
  keyword.value = "";
  level.value = "";
}
function openLog(log: RuntimeLog) {
  selectedLog.value = log;
  detailDrawerOpen.value = true;
}
function activateLog(event: KeyboardEvent, log: RuntimeLog) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openLog(log);
  }
}
</script>
<template>
  <section class="data-section monitoring-section">
    <div class="section-header">
      <div>
        <h2>心跳与运行日志</h2>
        <p>快速筛选仅作用于当前页，点击记录查看完整上下文</p>
      </div>
      <span>{{ filteredLogs.length }} 条 / 当前页 {{ logs.length }} 条</span>
    </div>
    <div class="compact-filter-bar monitoring-filter">
      <label class="search-field"
        ><span class="sr-only">搜索当前页日志</span><Search :size="15" /><input
          v-model="keyword"
          type="search"
          placeholder="搜索事件、设备或消息" /></label
      ><label
        ><span class="sr-only">日志级别</span
        ><select v-model="level">
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warn">警告</option>
          <option value="error">错误</option>
        </select></label
      ><button class="text-button filter-reset" type="button" :disabled="!keyword && !level" @click="resetFilters">
        <RotateCcw :size="13" />重置
      </button>
    </div>
    <div v-if="loading" class="loading-state" aria-live="polite">
      <RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取运行日志</span>
    </div>
    <div v-else-if="!logs.length" class="empty-state">
      <Wifi :size="28" aria-hidden="true" /><strong>暂无运行日志</strong
      ><span>插件连接服务端后，心跳和任务事件会出现在这里。</span>
    </div>
    <div v-else-if="!filteredLogs.length" class="empty-state compact">
      <Search :size="26" /><strong>当前页没有匹配记录</strong><span>调整关键词或级别筛选。</span>
    </div>
    <div v-else class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>级别</th>
            <th>事件</th>
            <th>设备</th>
            <th>消息</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="log in filteredLogs"
            :key="log.id"
            class="clickable-row"
            tabindex="0"
            @click="openLog(log)"
            @keydown="activateLog($event, log)"
          >
            <td>{{ formatTime(log.occurred_at) }}</td>
            <td>
              <span
                class="status"
                :data-status="log.level === 'error' ? 'failed' : log.level === 'warn' ? 'paused' : 'active'"
                >{{ log.level }}</span
              >
            </td>
            <td class="mono-cell">{{ log.event }}</td>
            <td class="mono-cell">{{ log.device_id }}</td>
            <td class="log-message-cell">{{ log.message }}</td>
            <td>
              <button class="row-detail-button" type="button" aria-label="查看日志详情" @click.stop="openLog(log)">
                <Eye :size="15" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationControl
      v-if="logs.length"
      :page="pagination.logs.page"
      :total-pages="pagination.logs.total_pages"
      :total="pagination.logs.total"
      item-label="条日志"
      @change="changePage('logs', $event)"
    /><el-drawer
      v-model="detailDrawerOpen"
      title="运行日志详情"
      size="min(560px, 100%)"
      class="admin-drawer detail-drawer"
      ><div v-if="selectedLog" class="detail-stack">
        <div class="detail-hero">
          <span class="drawer-icon"><Wifi :size="18" /></span>
          <div>
            <strong>{{ selectedLog.event }}</strong
            ><code>{{ selectedLog.id }}</code>
          </div>
          <span
            class="status"
            :data-status="selectedLog.level === 'error' ? 'failed' : selectedLog.level === 'warn' ? 'paused' : 'active'"
            >{{ selectedLog.level }}</span
          >
        </div>
        <dl class="detail-list">
          <div>
            <dt>发生时间</dt>
            <dd>{{ formatTime(selectedLog.occurred_at) }}</dd>
          </div>
          <div>
            <dt>设备</dt>
            <dd>{{ selectedLog.device_id }}</dd>
          </div>
          <div>
            <dt>任务</dt>
            <dd>{{ selectedLog.task_id || "无" }}</dd>
          </div>
          <div>
            <dt>消息</dt>
            <dd class="detail-message">{{ selectedLog.message }}</dd>
          </div>
          <div>
            <dt>元数据</dt>
            <dd>
              <pre>{{ JSON.stringify(selectedLog.metadata || {}, null, 2) }}</pre>
            </dd>
          </div>
        </dl>
      </div>
      <template #footer
        ><div class="drawer-footer"><el-button @click="detailDrawerOpen = false">关闭</el-button></div></template
      ></el-drawer
    >
  </section>
</template>
