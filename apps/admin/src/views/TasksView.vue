<script setup lang="ts">
import { computed, ref } from "vue";
import { Activity, Ban, Clock3, RefreshCw, Repeat2, RotateCcw, Send, SlidersHorizontal } from "lucide-vue-next";
import PaginationControl from "../components/PaginationControl.vue";
import { useAdminData } from "../useAdminData";

const {
  tasksDate, taskStatus, taskDeviceFilter, scheduleStatus, scheduleDeviceFilter, scheduleRecurrence,
  taskBusinessDate, taskMode, taskStartAt, taskTimeZone, tasks, schedules, taskDevices,
  taskDeviceId, creatingTask, cancellingTaskId, cancellingScheduleId, loading, pagination,
  applyTaskFilters, resetTaskFilters, createTask, cancelTask, cancelSchedule, changePage, formatTime, statusLabel
} = useAdminData();
const activeList = ref<"tasks" | "schedules">("tasks");
const hasTaskFilters = computed(() => Boolean(tasksDate.value || taskStatus.value || taskDeviceFilter.value));
const hasScheduleFilters = computed(() => Boolean(scheduleStatus.value || scheduleDeviceFilter.value || scheduleRecurrence.value));
</script>

<template>
  <div class="task-workspace">
    <section class="task-dispatch-bar" :data-mode="taskMode" aria-labelledby="task-dispatch-title">
      <div class="task-dispatch-title"><span class="task-dispatch-icon"><Send :size="16" aria-hidden="true" /></span><h2 id="task-dispatch-title">下发任务</h2></div>
      <div class="mode-segment" role="group" aria-label="任务模式">
        <button type="button" :class="{ active: taskMode === 'immediate' }" @click="taskMode = 'immediate'">立即</button>
        <button type="button" :class="{ active: taskMode === 'once' }" @click="taskMode = 'once'">单次预约</button>
        <button type="button" :class="{ active: taskMode === 'daily' }" @click="taskMode = 'daily'">每日</button>
      </div>
      <div class="task-dispatch-fields">
        <label class="task-device-field">目标设备<select v-model="taskDeviceId"><option value="" disabled>选择有效设备</option><option v-for="device in taskDevices.filter((entry) => entry.status === 'active')" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
        <label v-if="taskMode === 'immediate'">采集日期<input v-model="taskBusinessDate" type="date" /></label>
        <label v-else class="task-start-field">首次执行<input v-model="taskStartAt" type="datetime-local" /></label>
        <label v-if="taskMode !== 'immediate'" class="task-time-zone-field">时区<input v-model="taskTimeZone" type="text" /></label>
      </div>
      <button class="primary-button task-dispatch-submit" type="button" :disabled="creatingTask || !taskDeviceId" @click="createTask"><RefreshCw v-if="creatingTask" :size="16" class="spinning" aria-hidden="true" /><Clock3 v-else-if="taskMode !== 'immediate'" :size="16" aria-hidden="true" /><Send v-else :size="16" aria-hidden="true" /><span>{{ creatingTask ? '创建中' : taskMode === 'immediate' ? '立即下发' : '创建计划' }}</span></button>
    </section>

    <section class="data-section task-center-card" aria-label="任务列表">
      <header class="task-center-toolbar">
        <div class="task-list-tabs" role="tablist" aria-label="任务中心列表">
          <button id="tasks-tab" type="button" role="tab" :aria-selected="activeList === 'tasks'" aria-controls="tasks-panel" :class="{ active: activeList === 'tasks' }" @click="activeList = 'tasks'">已下发任务 <span>{{ pagination.tasks.total }}</span></button>
          <button id="schedules-tab" type="button" role="tab" :aria-selected="activeList === 'schedules'" aria-controls="schedules-panel" :class="{ active: activeList === 'schedules' }" @click="activeList = 'schedules'">预约计划 <span>{{ pagination.schedules.total }}</span></button>
        </div>
        <span class="count-label">{{ activeList === 'tasks' ? tasks.length + ' 条 / 共 ' + pagination.tasks.total + ' 条' : schedules.length + ' 条 / 共 ' + pagination.schedules.total + ' 条' }}</span>
      </header>

      <section class="filter-panel task-filter-panel" aria-labelledby="task-filter-title">
        <div class="filter-panel-heading"><SlidersHorizontal :size="16" aria-hidden="true" /><div><h2 id="task-filter-title">{{ activeList === 'tasks' ? '筛选已下发任务' : '筛选预约计划' }}</h2><p>默认展示全部记录，筛选条件只影响当前列表。</p></div></div>
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
        <div class="filter-panel-summary"><span>{{ activeList === 'tasks' ? '共 ' + pagination.tasks.total + ' 项任务' : '共 ' + pagination.schedules.total + ' 项计划' }}</span><button class="text-button" type="button" :disabled="activeList === 'tasks' ? !hasTaskFilters : !hasScheduleFilters" @click="resetTaskFilters(activeList)"><RotateCcw :size="13" aria-hidden="true" />清除筛选</button></div>
      </section>

      <div v-if="activeList === 'tasks'" id="tasks-panel" class="task-list-panel" role="tabpanel" aria-labelledby="tasks-tab">
        <div v-if="loading" class="loading-state"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取任务</span></div>
        <div v-else-if="!tasks.length" class="empty-state compact"><Activity :size="26" aria-hidden="true" /><strong>没有符合条件的任务</strong><span>调整筛选条件，或从上方下发新的采集任务。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>创建时间</th><th>设备</th><th>日期</th><th>状态</th><th>批次</th><th>错误</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id"><td>{{ formatTime(task.created_at) }}</td><td class="mono-cell">{{ task.device_id }}</td><td>{{ task.business_date }}</td><td><span class="status" :data-status="task.status">{{ statusLabel(task.status) }}</span></td><td class="mono-cell">{{ task.run_id || '—' }}</td><td class="danger-text">{{ task.error_code || '—' }}</td><td><button v-if="['pending', 'running', 'paused'].includes(task.status)" class="danger-button" type="button" :disabled="cancellingTaskId === task.id" @click="cancelTask(task)"><Ban :size="14" aria-hidden="true" />{{ cancellingTaskId === task.id ? '取消中' : '取消任务' }}</button><span v-else class="muted">已结束</span></td></tr></tbody></table></div>
        <PaginationControl v-if="tasks.length" :page="pagination.tasks.page" :total-pages="pagination.tasks.total_pages" :total="pagination.tasks.total" item-label="项任务" @change="changePage('tasks', $event)" />
      </div>
      <div v-else id="schedules-panel" class="task-list-panel" role="tabpanel" aria-labelledby="schedules-tab">
        <div v-if="loading" class="loading-state"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取预约计划</span></div>
        <div v-else-if="!schedules.length" class="empty-state compact"><Repeat2 :size="26" aria-hidden="true" /><strong>没有符合条件的预约计划</strong><span>调整筛选条件，或选择单次预约、每日模式创建计划。</span></div>
        <div v-else class="table-scroll"><table><thead><tr><th>模式</th><th>设备</th><th>状态</th><th>下次执行</th><th>时区</th><th>操作</th></tr></thead><tbody><tr v-for="schedule in schedules" :key="schedule.id"><td>{{ schedule.recurrence === 'daily' ? '每日' : '单次' }}</td><td class="mono-cell">{{ schedule.device_id }}</td><td><span class="status" :data-status="schedule.status">{{ statusLabel(schedule.status) }}</span></td><td>{{ formatTime(schedule.next_run_at || schedule.start_at) }}</td><td>{{ schedule.time_zone }}</td><td><button v-if="schedule.status === 'active'" class="danger-button" type="button" :disabled="cancellingScheduleId === schedule.id" @click="cancelSchedule(schedule)"><Ban :size="14" aria-hidden="true" />{{ cancellingScheduleId === schedule.id ? '停用中' : '停用' }}</button><span v-else class="muted">已结束</span></td></tr></tbody></table></div>
        <PaginationControl v-if="schedules.length" :page="pagination.schedules.page" :total-pages="pagination.schedules.total_pages" :total="pagination.schedules.total" item-label="项计划" @change="changePage('schedules', $event)" />
      </div>
    </section>
  </div>
</template>
