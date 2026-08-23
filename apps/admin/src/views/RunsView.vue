<script setup lang="ts">
import { CalendarDays, Database, ExternalLink, Layers3, RefreshCw } from "lucide-vue-next";
import PaginationControl from "../components/PaginationControl.vue";
import { useAdminData } from "../useAdminData";

const {
  runsDate,
  runs,
  items,
  selectedRun,
  loading,
  loadingItems,
  selectedItem,
  pagination,
  changeDate,
  selectRun,
  changePage,
  formatTime,
  statusLabel
} = useAdminData();
</script>

<template>
  <section class="runs-workspace" aria-label="采集批次与项目结果">
    <aside class="runs-sidebar-panel">
      <div class="workspace-panel-header">
        <div>
          <span class="eyebrow">DAILY RUNS</span>
          <h2>采集批次</h2>
        </div>
        <span class="count-label">{{ pagination.runs.total }}</span>
      </div>
      <div class="module-filter-row">
        <label class="module-date-filter"
          ><span><CalendarDays :size="15" aria-hidden="true" />批次日期</span
          ><el-date-picker
            v-model="runsDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            :disabled="loading"
            @change="changeDate('runs')"
        /></label>
      </div>
      <div v-if="loading" class="loading-state compact" aria-live="polite">
        <RefreshCw :size="18" class="spinning" aria-hidden="true" /><span>正在读取批次</span>
      </div>
      <div v-else-if="!runs.length" class="empty-state compact">
        <Database :size="26" aria-hidden="true" /><strong>当天暂无批次</strong
        ><span>扩展完成采集后，批次会出现在这里。</span>
      </div>
      <div v-else class="run-list" role="listbox" aria-label="采集批次列表">
        <button
          v-for="run in runs"
          :key="run.id"
          class="run-list-item"
          :class="{ selected: selectedRun?.id === run.id }"
          type="button"
          role="option"
          :aria-selected="selectedRun?.id === run.id"
          @click="selectRun(run)"
        >
          <span class="run-list-item-top"
            ><strong>{{ formatTime(run.createdAt) }}</strong
            ><span class="status" :data-status="run.status">{{ statusLabel(run.status) }}</span></span
          >
          <span class="run-list-item-source">{{ run.deviceId }}</span>
          <span class="run-list-item-stats"
            ><span>{{ run.itemCount }} 项目</span><span class="success-text">{{ run.successCount }} 成功</span
            ><span class="danger-text">{{ run.failureCount }} 失败</span></span
          >
        </button>
      </div>
      <PaginationControl
        v-if="runs.length"
        :page="pagination.runs.page"
        :total-pages="pagination.runs.total_pages"
        :total="pagination.runs.total"
        item-label="个批次"
        @change="changePage('runs', $event)"
      />
    </aside>

    <section class="results-panel" aria-live="polite">
      <div class="workspace-panel-header results-header">
        <div>
          <span class="eyebrow">COLLECTION RESULTS</span>
          <h2>{{ selectedRun ? "项目采集结果" : "选择一个批次" }}</h2>
          <p>
            {{
              selectedRun
                ? `${selectedRun.businessDate} · ${selectedRun.sourceUrl}`
                : "从左侧选择批次，查看项目读取情况和 README。"
            }}
          </p>
        </div>
        <a v-if="selectedRun" class="secondary-button" :href="selectedRun.sourceUrl" target="_blank" rel="noreferrer"
          ><ExternalLink :size="15" aria-hidden="true" />打开来源</a
        >
      </div>
      <div v-if="loadingItems" class="loading-state" aria-live="polite">
        <RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取项目结果</span>
      </div>
      <div v-else-if="!selectedRun" class="workspace-empty">
        <Layers3 :size="34" aria-hidden="true" /><strong>项目结果会显示在这里</strong
        ><span>批次、设备和成功/失败摘要已经集中在左侧，选中后无需离开当前页面。</span>
      </div>
      <div v-else-if="!items.length" class="workspace-empty">
        <Layers3 :size="34" aria-hidden="true" /><strong>该批次暂无项目</strong
        ><span>采集可能仍在进行，刷新后再次查看。</span>
      </div>
      <div v-else class="results-table-wrap">
        <div class="results-toolbar">
          <span>{{ items.length }} 条 / 共 {{ pagination.items.total }} 条项目</span><span>点击行查看 README</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>项目</th>
                <th>状态</th>
                <th>读取时间</th>
                <th>错误</th>
                <th aria-label="README"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                tabindex="0"
                @click="selectedItem = item"
                @keydown.enter="selectedItem = item"
              >
                <td class="rank-cell">#{{ item.rank }}</td>
                <td>
                  <strong>{{ item.name }}</strong
                  ><small>{{ item.projectUrl }}</small>
                </td>
                <td>
                  <span class="status" :data-status="item.status">{{ statusLabel(item.status) }}</span>
                </td>
                <td>{{ formatTime(item.readAt) }}</td>
                <td class="danger-text">{{ item.errorCode || "—" }}</td>
                <td>
                  <button class="text-button" type="button" @click.stop="selectedItem = item">查看 README</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <PaginationControl
        v-if="items.length"
        :page="pagination.items.page"
        :total-pages="pagination.items.total_pages"
        :total="pagination.items.total"
        item-label="个项目"
        @change="changePage('items', $event)"
      />
    </section>
  </section>
</template>
