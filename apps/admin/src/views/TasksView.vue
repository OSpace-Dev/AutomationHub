<script setup lang="ts">
import { Activity, Ban, CalendarDays, Clock3, RefreshCw, Repeat2 } from "lucide-vue-next";
import { ref } from "vue";
import PaginationControl from "../components/PaginationControl.vue";
import { useAdminData } from "../useAdminData";

const { tasksDate, taskBusinessDate, taskMode, taskStartAt, taskTimeZone, tasks, schedules, taskDevices, taskDeviceId, creatingTask, cancellingTaskId, cancellingScheduleId, loading, pagination, changeDate, createTask, cancelTask, cancelSchedule, changePage, formatTime, statusLabel } = useAdminData();
const activeList = ref<"tasks" | "schedules">("tasks");
</script>

<template>
  <div class="task-workspace">
    <section class="task-create-card">
      <div class="section-header"><h2>下发采集任务</h2><div class="mode-segment" role="group" aria-label="任务模式"><button type="button" :class="{ active: taskMode === 'immediate' }" @click="taskMode = 'immediate'">立即</button><button type="button" :class="{ active: taskMode === 'once' }" @click="taskMode = 'once'">单次预约</button><button type="button" :class="{ active: taskMode === 'daily' }" @click="taskMode = 'daily'">每日</button></div></div>
      <div class="task-create-row"><label>目标设备<select v-model="taskDeviceId"><option value="" disabled>选择有效设备</option><option v-for="device in taskDevices.filter((entry) => entry.status === 'active')" :key="device.id" :value="device.id">{{ device.name }}</option></select></label><label v-if="taskMode === 'immediate'">采集日期<input v-model="taskBusinessDate" type="date" /></label><label v-else>首次执行<input v-model="taskStartAt" type="datetime-local" /></label><label v-if="taskMode !== 'immediate'">时区<input v-model="taskTimeZone" type="text" /></label><button class="primary-button" type="button" :disabled="creatingTask || !taskDeviceId" @click="createTask"><RefreshCw v-if="creatingTask" :size="16" class="spinning" aria-hidden="true" /><Clock3 v-else-if="taskMode !== 'immediate'" :size="16" aria-hidden="true" /><span>{{ creatingTask ? '创建中' : taskMode === 'immediate' ? '立即下发' : '创建计划' }}</span></button></div>
    </section>
    <section class="data-section task-center-card">
      <div class="section-header"><div><span class="eyebrow">TASK CENTER</span><h2>{{ activeList === 'tasks' ? '已下发任务' : '预约计划' }}</h2><p>{{ activeList === 'tasks' ? '按时间倒序查看任务状态、批次和错误。' : '停用计划只阻止未来任务，已经生成的任务仍可单独取消。' }}</p></div><span>{{ activeList === 'tasks' ? `${tasks.length} 条 / 共 ${pagination.tasks.total} 条` : `${schedules.length} 条 / 共 ${pagination.schedules.total} 条` }}</span></div>
      <div class="task-list-tabs" role="tablist" aria-label="任务中心列表">
        <button id="tasks-tab" type="button" role="tab" :aria-selected="activeList === 'tasks'" aria-controls="tasks-panel" :class="{ active: activeList === 'tasks' }" @click="activeList = 'tasks'">已下发任务 <span>{{ pagination.tasks.total }}</span></button>
        <button id="schedules-tab" type="button" role="tab" :aria-selected="activeList === 'schedules'" aria-controls="schedules-panel" :class="{ active: activeList === 'schedules' }" @click="activeList = 'schedules'">预约计划 <span>{{ pagination.schedules.total }}</span></button>
      </div>
      <div v-if="activeList === 'tasks'" id="tasks-panel" class="task-list-panel" role="tabpanel" aria-labelledby="tasks-tab">
        <div class="module-filter-row"><label class="module-date-filter"><span><CalendarDays :size="15" aria-hidden="true" />任务日期</span><input v-model="tasksDate" type="date" @change="changeDate('tasks')" /></label></div>
        <div v-if="loading" class="loading-state"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取任务</span></div>
        <div v-else-if="!tasks.length" class="empty-state compact"><Activity :size="26" aria-hidden="true" /><strong>暂无任务</strong><span>从上方选择设备后下发一项 Trending 采集。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>创建时间</th><th>设备</th><th>日期</th><th>状态</th><th>批次</th><th>错误</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id"><td>{{ formatTime(task.created_at) }}</td><td class="mono-cell">{{ task.device_id }}</td><td>{{ task.business_date }}</td><td><span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span></td><td class="mono-cell">{{ task.run_id || '—' }}</td><td class="danger-text">{{ task.error_code || '—' }}</td><td><button v-if="['pending', 'running', 'paused'].includes(task.status)" class="danger-button" type="button" :disabled="cancellingTaskId === task.id" @click="cancelTask(task)"><Ban :size="14" aria-hidden="true" />{{ cancellingTaskId === task.id ? '取消中' : '取消任务' }}</button><span v-else class="muted">已结束</span></td></tr></tbody></table></div>
        <PaginationControl v-if="tasks.length" :page="pagination.tasks.page" :total-pages="pagination.tasks.total_pages" :total="pagination.tasks.total" item-label="项任务" @change="changePage('tasks', $event)" />
      </div>
      <div v-else id="schedules-panel" class="task-list-panel" role="tabpanel" aria-labelledby="schedules-tab">
        <div v-if="loading" class="loading-state"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取预约计划</span></div>
        <div v-else-if="!schedules.length" class="empty-state compact"><Repeat2 :size="26" aria-hidden="true" /><strong>暂无预约计划</strong><span>选择单次预约或每日模式创建计划。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>模式</th><th>设备</th><th>状态</th><th>下次执行</th><th>时区</th><th>操作</th></tr></thead><tbody><tr v-for="schedule in schedules" :key="schedule.id"><td>{{ schedule.recurrence === 'daily' ? '每日' : '单次' }}</td><td class="mono-cell">{{ schedule.device_id }}</td><td><span class="status" :data-status="schedule.status">{{ statusLabel(schedule.status) }}</span></td><td>{{ formatTime(schedule.next_run_at || schedule.start_at) }}</td><td>{{ schedule.time_zone }}</td><td><button v-if="schedule.status === 'active'" class="danger-button" type="button" :disabled="cancellingScheduleId === schedule.id" @click="cancelSchedule(schedule)"><Ban :size="14" aria-hidden="true" />{{ cancellingScheduleId === schedule.id ? '停用中' : '停用' }}</button><span v-else class="muted">已结束</span></td></tr></tbody></table></div>
        <PaginationControl v-if="schedules.length" :page="pagination.schedules.page" :total-pages="pagination.schedules.total_pages" :total="pagination.schedules.total" item-label="项计划" @change="changePage('schedules', $event)" />
      </div>
    </section>
  </div>
</template>
