<script setup lang="ts">
import { Bot, Plus, RefreshCw } from "lucide-vue-next";
import type { ModelProvider } from "../../admin-models";

defineProps<{
  providers: ModelProvider[];
  selectedProvider: ModelProvider | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  new: [];
  select: [provider: ModelProvider];
}>();
</script>

<template>
  <aside class="model-list-panel">
    <div class="workspace-panel-header">
      <div>
        <span class="eyebrow">MODEL SERVICES</span>
        <h2>模型服务</h2>
      </div>
      <button class="icon-button" type="button" title="新建配置" aria-label="新建配置" @click="emit('new')">
        <Plus :size="17" />
      </button>
    </div>
    <div v-if="loading" class="loading-state compact">
      <RefreshCw :size="18" class="spinning" /><span>正在读取配置</span>
    </div>
    <div v-else-if="!providers.length" class="empty-state compact">
      <Bot :size="27" /><strong>尚未配置模型</strong><span>新建一个 OpenAI 兼容服务后即可生成日报。</span>
    </div>
    <div v-else class="model-provider-list">
      <button
        v-for="provider in providers"
        :key="provider.id"
        type="button"
        class="model-provider-item"
        :class="{ selected: selectedProvider?.id === provider.id }"
        @click="emit('select', provider)"
      >
        <span
          ><strong>{{ provider.name }}</strong
          ><em v-if="provider.is_default">默认</em></span
        >
        <small>{{ provider.selected_model }}</small>
        <small>{{ provider.base_url }}</small>
      </button>
    </div>
  </aside>
</template>
