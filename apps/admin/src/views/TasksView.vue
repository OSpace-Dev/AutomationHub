<script setup lang="ts">
import { computed, ref } from "vue";
import { Activity, Ban, CalendarClock, Clock3, Eye, Plus, RefreshCw, Repeat2, RotateCcw, Send } from "lucide-vue-next";
import PaginationControl from "../components/PaginationControl.vue";
import type { Task, TaskSchedule } from "../admin-models";
import { useAdminData } from "../useAdminData";

const {
  tasksDate, taskStatus, taskDeviceFilter, scheduleStatus, scheduleDeviceFilter, scheduleRecurrence,
  taskBusinessDate, taskMode, taskStartAt, taskTimeZone, tasks, schedules, taskDevices,
  taskDeviceId, creatingTask, cancellingTaskId, cancellingScheduleId, loading, pagination,
  applyTaskFilters, resetTaskFilters, createTask, cancelTask, cancelSchedule, changePage, formatTime, statusLabel
} = useAdminData();
const activeList = ref<"tasks" | "schedules">("tasks");
const createDrawerOpen = ref(false);
const selectedRecord = ref<Task | TaskSchedule | null>(null);
const detailDrawerOpen = ref(false);
const hasTaskFilters = computed(() => Boolean(tasksDate.value || taskStatus.value || taskDeviceFilter.value));
const hasScheduleFilters = computed(() => Boolean(scheduleStatus.value || scheduleDeviceFilter.value || scheduleRecurrence.value));
const selectedIsTask = computed(() => Boolean(selectedRecord.value && "business_date" in selectedRecord.value));
const selectedSchedule = computed(() => selectedRecord.value && !selectedIsTask.value ? selectedRecord.value as TaskSchedule : null);
async function submitTask() { if (await createTask()) createDrawerOpen.value = false; }
function openRecord(record: Task | TaskSchedule) { selectedRecord.value = record; detailDrawerOpen.value = true; }
async function cancelSelectedTask(task: Task) { if (await cancelTask(task)) detailDrawerOpen.value = false; }
async function cancelSelectedSchedule(schedule: TaskSchedule) { if (await cancelSchedule(schedule)) detailDrawerOpen.value = false; }
function activateRecord(event: KeyboardEvent, record: Task | TaskSchedule) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRecord(record); } }
</script>

<template>
  <div class="task-workspace">
    <section class="data-section task-center-card" aria-label="任务列表">
      <header class="task-center-toolbar">
        <div class="task-list-tabs" role="tablist" aria-label="任务中心列表">
          <button id="tasks-tab" type="button" role="tab" :aria-selected="activeList === 'tasks'" aria-controls="tasks-panel" :class="{ active: activeList === 'tasks' }" @click="activeList = 'tasks'">已下发任务 <span>{{ pagination.tasks.total }}</span></button>
          <button id="schedules-tab" type="button" role="tab" :aria-selected="activeList === 'schedules'" aria-controls="schedules-panel" :class="{ active: activeList === 'schedules' }" @click="activeList = 'schedules'">预约计划 <span>{{ pagination.schedules.total }}</span></button>
        </div>
        <el-button type="primary" @click="createDrawerOpen = true"><Plus :size="16" aria-hidden="true" />下发任务</el-button>
      </header>

      <section class="compact-filter-bar" aria-label="任务筛选">
        <div v-if="activeList === 'tasks'" class="filter-fields">
          <label><span>任务日期</span><input v-model="tasksDate" type="date" @change="applyTaskFilters('tasks')" /></label>
          <label><span>状态</span><select v-model="taskStatus" @change="applyTaskFilters('tasks')"><option value="">全部状态</option><option value="pending">待处理</option><option value="running">进行中</option><option value="paused">已暂停</option><option value="completed">完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select></label>
          <label><span>设备</span><select v-model="taskDeviceFilter" @change="applyTaskFilters('tasks')"><option value="">全部设备</option><option v-for="device in taskDevices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
        </div>
        <div v-else class="filter-fields">
          <label><span>状态</span><select v-model="scheduleStatus" @change="applyTaskFilters('schedules')"><option value="">全部状态</option><option value="active">有效</option><option value="completed">完成</option><option value="cancelled">已取消</option></select></label>
          <label><span>设备</span><select v-model="scheduleDeviceFilter" @change="applyTaskFilters('schedules')"><option value="">全部设备</option><option v-for="device in taskDevices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
          <label><span>频率</span><select v-model="scheduleRecurrence" @change="applyTaskFilters('schedules')"><option value="">全部频率</option><option value="once">单次</option><option value="daily">每日</option></select></label>
        </div>
        <button class="text-button filter-reset" type="button" :disabled="activeList === 'tasks' ? !hasTaskFilters : !hasScheduleFilters" @click="resetTaskFilters(activeList)"><RotateCcw :size="13" aria-hidden="true" />重置</button>
      </section>

      <div v-if="activeList === 'tasks'" id="tasks-panel" class="task-list-panel" role="tabpanel" aria-labelledby="tasks-tab">
        <div v-if="loading" class="loading-state" aria-live="polite"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取任务</span></div>
        <div v-else-if="!tasks.length" class="empty-state compact"><Activity :size="26" aria-hidden="true" /><strong>没有符合条件的任务</strong><span>调整筛选条件，或从上方下发新的采集任务。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>创建时间</th><th>设备</th><th>日期</th><th>状态</th><th>批次</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id" class="clickable-row" tabindex="0" @click="openRecord(task)" @keydown="activateRecord($event, task)"><td>{{ formatTime(task.created_at) }}</td><td class="mono-cell">{{ task.device_id }}</td><td>{{ task.business_date }}</td><td><span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span></td><td class="mono-cell">{{ task.run_id || '—' }}</td><td><button class="row-detail-button" type="button" aria-label="查看任务详情" @click.stop="openRecord(task)"><Eye :size="15" /></button></td></tr></tbody></table></div>
        <PaginationControl v-if="tasks.length" :page="pagination.tasks.page" :total-pages="pagination.tasks.total_pages" :total="pagination.tasks.total" item-label="项任务" @change="changePage('tasks', $event)" />
      </div>
      <div v-else id="schedules-panel" class="task-list-panel" role="tabpanel" aria-labelledby="schedules-tab">
        <div v-if="loading" class="loading-state" aria-live="polite"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取预约计划</span></div>
        <div v-else-if="!schedules.length" class="empty-state compact"><Repeat2 :size="26" aria-hidden="true" /><strong>没有符合条件的预约计划</strong><span>调整筛选条件，或选择单次预约、每日模式创建计划。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>模式</th><th>设备</th><th>状态</th><th>下次执行</th><th>时区</th><th>操作</th></tr></thead><tbody><tr v-for="schedule in schedules" :key="schedule.id" class="clickable-row" tabindex="0" @click="openRecord(schedule)" @keydown="activateRecord($event, schedule)"><td>{{ schedule.recurrence === 'daily' ? '每日' : '单次' }}</td><td class="mono-cell">{{ schedule.device_id }}</td><td><span class="status" :data-status="schedule.status">{{ statusLabel(schedule.status) }}</span></td><td>{{ formatTime(schedule.next_run_at || schedule.start_at) }}</td><td>{{ schedule.time_zone }}</td><td><button class="row-detail-button" type="button" aria-label="查看计划详情" @click.stop="openRecord(schedule)"><Eye :size="15" /></button></td></tr></tbody></table></div>
        <PaginationControl v-if="schedules.length" :page="pagination.schedules.page" :total-pages="pagination.schedules.total_pages" :total="pagination.schedules.total" item-label="项计划" @change="changePage('schedules', $event)" />
      </div>
    </section>

    <el-drawer v-model="createDrawerOpen" title="下发采集任务" size="min(560px, 100%)" class="admin-drawer" :close-on-click-modal="!creatingTask" :close-on-press-escape="!creatingTask">
      <div class="drawer-form"><div class="drawer-intro"><span class="drawer-icon"><Send :size="18" /></span><div><strong>选择任务执行方式</strong><span>创建成功后会保留当前列表筛选和分页位置。</span></div></div><div class="mode-segment drawer-mode" role="group" aria-label="任务模式"><button type="button" :class="{ active: taskMode === 'immediate' }" @click="taskMode = 'immediate'">立即</button><button type="button" :class="{ active: taskMode === 'once' }" @click="taskMode = 'once'">单次预约</button><button type="button" :class="{ active: taskMode === 'daily' }" @click="taskMode = 'daily'">每日</button></div><label>目标设备<select v-model="taskDeviceId"><option value="" disabled>选择有效设备</option><option v-for="device in taskDevices.filter((entry) => entry.status === 'active')" :key="device.id" :value="device.id">{{ device.name }}</option></select></label><label v-if="taskMode === 'immediate'">采集日期<input v-model="taskBusinessDate" type="date" /></label><label v-else>首次执行<input v-model="taskStartAt" type="datetime-local" /></label><label v-if="taskMode !== 'immediate'">时区<input v-model="taskTimeZone" type="text" /></label></div>
      <template #footer><div class="drawer-footer"><el-button :disabled="creatingTask" @click="createDrawerOpen = false">取消</el-button><el-button type="primary" :loading="creatingTask" :disabled="!taskDeviceId" @click="submitTask"><Clock3 v-if="taskMode !== 'immediate' && !creatingTask" :size="16" /><Send v-else-if="!creatingTask" :size="16" />{{ taskMode === 'immediate' ? '立即下发' : '创建计划' }}</el-button></div></template>
    </el-drawer>

    <el-drawer v-model="detailDrawerOpen" :title="selectedIsTask ? '任务详情' : '计划详情'" size="min(520px, 100%)" class="admin-drawer detail-drawer">
      <div v-if="selectedRecord" class="detail-stack"><div class="detail-hero"><span class="drawer-icon"><Activity v-if="selectedIsTask" :size="18" /><CalendarClock v-else :size="18" /></span><div><strong>{{ selectedIsTask ? '采集任务' : selectedSchedule?.recurrence === 'daily' ? '每日计划' : '单次计划' }}</strong><code>{{ selectedRecord.id }}</code></div><span class="status" :data-status="selectedRecord.status">{{ statusLabel(selectedRecord.status) }}</span></div><dl class="detail-list"><div><dt>设备</dt><dd>{{ selectedRecord.device_id }}</dd></div><div><dt>状态</dt><dd>{{ statusLabel(selectedRecord.status) }}</dd></div><template v-if="selectedIsTask"><div><dt>业务日期</dt><dd>{{ (selectedRecord as Task).business_date }}</dd></div><div><dt>创建时间</dt><dd>{{ formatTime(selectedRecord.created_at) }}</dd></div><div><dt>批次</dt><dd>{{ (selectedRecord as Task).run_id || '尚未生成' }}</dd></div><div><dt>错误</dt><dd>{{ (selectedRecord as Task).error_code || '无' }}</dd></div></template><template v-else><div><dt>首次执行</dt><dd>{{ formatTime((selectedRecord as TaskSchedule).start_at) }}</dd></div><div><dt>下次执行</dt><dd>{{ formatTime((selectedRecord as TaskSchedule).next_run_at || (selectedRecord as TaskSchedule).start_at) }}</dd></div><div><dt>时区</dt><dd>{{ (selectedRecord as TaskSchedule).time_zone }}</dd></div></template></dl></div>
      <template #footer><div v-if="selectedRecord" class="drawer-footer"><el-button v-if="selectedIsTask && ['pending', 'running', 'paused'].includes(selectedRecord.status)" type="danger" :loading="cancellingTaskId === selectedRecord.id" @click="cancelSelectedTask(selectedRecord as Task)"><Ban :size="15" />取消任务</el-button><el-button v-else-if="!selectedIsTask && selectedRecord.status === 'active'" type="danger" :loading="cancellingScheduleId === selectedRecord.id" @click="cancelSelectedSchedule(selectedRecord as TaskSchedule)"><Ban :size="15" />停用计划</el-button><el-button @click="detailDrawerOpen = false">关闭</el-button></div></template>
    </el-drawer>
  </div>
</template>
