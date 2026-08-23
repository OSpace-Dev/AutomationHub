<script setup lang="ts">
import { RefreshCw, Server } from "lucide-vue-next";

defineProps<{
  apiOrigin: string;
  apiKey: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:apiOrigin": [value: string];
  "update:apiKey": [value: string];
  connect: [];
}>();
</script>

<template>
  <section class="connection-band" aria-label="管理 API 连接设置">
    <div class="connection-heading">
      <Server :size="19" aria-hidden="true" />
      <div>
        <strong>管理 API</strong>
        <span>本地默认连接 localhost:3000，管理密钥可留空</span>
      </div>
    </div>
    <label>
      API 地址
      <el-input
        :model-value="apiOrigin"
        type="url"
        placeholder="http://localhost:3000"
        @update:model-value="emit('update:apiOrigin', $event)"
      />
    </label>
    <label>
      管理密钥
      <el-input
        :model-value="apiKey"
        type="password"
        autocomplete="off"
        placeholder="受保护部署时填写"
        show-password
        @update:model-value="emit('update:apiKey', $event)"
      />
    </label>
    <el-button type="primary" :loading="loading" @click="emit('connect')">
      <RefreshCw v-if="!loading" :size="16" aria-hidden="true" />
      <span>{{ loading ? "连接中" : "连接并读取" }}</span>
    </el-button>
  </section>
</template>
