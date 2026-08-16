<script setup lang="ts">
import { Copy, KeyRound, Monitor, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import PaginationControl from "../components/PaginationControl.vue";
import { useAdminData } from "../useAdminData";

const { devices, authorizations, authorizationExpiresIn, createdAuthorizationCode, creatingAuthorization, deletingAuthorizationId, loading, pagination, revokingDeviceId, createAuthorization, deleteAuthorization, copyAuthorizationCode, revokeDevice, changePage, formatTime, statusLabel, isDeviceOnline, deviceStatusLabel } = useAdminData();
</script>

<template>
  <div class="device-workspace">
    <section class="authorization-card">
      <div class="section-header"><div><span class="eyebrow">DEVICE AUTHORIZATION</span><h2>插件授权</h2><p>每个授权码只能连接一个浏览器，明文仅在生成后展示一次。</p></div><span>{{ pagination.authorizations.total }} 个有效记录</span></div>
      <div class="authorization-create-row"><label>有效期<select v-model="authorizationExpiresIn"><option value="24h">24 小时</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="never">永久有效</option></select></label><button class="primary-button" type="button" :disabled="creatingAuthorization" @click="createAuthorization"><RefreshCw v-if="creatingAuthorization" :size="16" class="spinning" aria-hidden="true" /><Plus v-else :size="16" aria-hidden="true" /><span>{{ creatingAuthorization ? '生成中' : '添加授权' }}</span></button></div>
      <div v-if="createdAuthorizationCode" class="authorization-secret" role="status"><div><span>新授权码</span><code>{{ createdAuthorizationCode }}</code><small>关闭或刷新后不再显示，请现在粘贴到插件。</small></div><button class="secondary-button" type="button" @click="copyAuthorizationCode"><Copy :size="15" aria-hidden="true" />复制</button></div>
      <div v-if="!authorizations.length && !loading" class="empty-state compact"><KeyRound :size="26" aria-hidden="true" /><strong>暂无授权</strong><span>生成授权码后即可连接新的浏览器插件。</span></div>
      <div v-else-if="authorizations.length" class="authorization-list"><div v-for="authorization in authorizations" :key="authorization.id" class="authorization-row"><div><strong>AH-••••-{{ authorization.code_hint }}</strong><span>创建于 {{ formatTime(authorization.created_at) }}</span></div><span class="status" :data-status="authorization.status">{{ statusLabel(authorization.status) }}</span><span>{{ authorization.expires_at ? formatTime(authorization.expires_at) : '永久有效' }}</span><span class="mono-cell">{{ authorization.device_id || '尚未绑定' }}</span><button class="icon-button danger-icon" type="button" title="删除授权" aria-label="删除授权" :disabled="deletingAuthorizationId === authorization.id" @click="deleteAuthorization(authorization)"><RefreshCw v-if="deletingAuthorizationId === authorization.id" :size="15" class="spinning" /><Trash2 v-else :size="15" /></button></div></div>
      <PaginationControl v-if="authorizations.length" :page="pagination.authorizations.page" :total-pages="pagination.authorizations.total_pages" :total="pagination.authorizations.total" item-label="个授权" @change="changePage('authorizations', $event)" />
    </section>

    <section class="data-section devices-section"><div class="section-header"><div><h2>设备列表</h2><p>查看授权状态、最近心跳和本地待上传队列</p></div><span>{{ devices.length }} 台 / 共 {{ pagination.devices.total }} 台</span></div>
      <div v-if="loading" class="loading-state"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在读取设备</span></div><div v-else-if="!devices.length" class="empty-state"><Monitor :size="28" aria-hidden="true" /><strong>暂无采集设备</strong><span>生成授权码并在扩展中完成连接后，设备会出现在这里。</span></div>
      <div v-else class="table-scroll"><table><thead><tr><th>设备</th><th>连接</th><th>扩展版本</th><th>注册时间</th><th>最后心跳</th><th>待上传</th><th>操作</th></tr></thead><tbody><tr v-for="device in devices" :key="device.id"><td><strong>{{ device.name }}</strong><small class="mono-cell">{{ device.id }}</small></td><td><span class="status" :data-status="device.status === 'revoked' ? 'revoked' : isDeviceOnline(device) ? 'active' : 'pending'">{{ deviceStatusLabel(device) }}</span></td><td>{{ device.extension_version }}</td><td>{{ formatTime(device.registered_at) }}</td><td>{{ formatTime(device.last_heartbeat_at) }}</td><td>{{ device.queue_depth }}</td><td><button v-if="device.status === 'active'" class="danger-button" type="button" :disabled="revokingDeviceId === device.id" @click="revokeDevice(device)">{{ revokingDeviceId === device.id ? '撤销中' : '撤销' }}</button><span v-else class="muted">已处理</span></td></tr></tbody></table></div><PaginationControl v-if="devices.length" :page="pagination.devices.page" :total-pages="pagination.devices.total_pages" :total="pagination.devices.total" item-label="台设备" @change="changePage('devices', $event)" />
    </section>
  </div>
</template>
