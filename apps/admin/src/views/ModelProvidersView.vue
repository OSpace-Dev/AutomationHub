<script setup lang="ts">
import { Bot, CheckCircle2, KeyRound, Plus, RefreshCw, Save, Trash2 } from "lucide-vue-next";
import { onMounted } from "vue";
import { useModelProvidersData } from "../useModelProvidersData";

const { providers, selectedProvider, providerLoading, providerActionLoading, providerError, availableModels, modelFetchLoading, providerForm, refreshProviders, selectProvider, newProvider, fetchModels, saveProvider, deleteProvider } = useModelProvidersData();
onMounted(() => { void refreshProviders(); });
</script>

<template>
  <section class="models-workspace">
    <aside class="model-list-panel">
      <div class="workspace-panel-header"><div><span class="eyebrow">MODEL SERVICES</span><h2>模型服务</h2></div><button class="icon-button" type="button" title="新建配置" aria-label="新建配置" @click="newProvider"><Plus :size="17" /></button></div>
      <div v-if="providerLoading" class="loading-state compact"><RefreshCw :size="18" class="spinning" /><span>正在读取配置</span></div>
      <div v-else-if="!providers.length" class="empty-state compact"><Bot :size="27" /><strong>尚未配置模型</strong><span>新建一个 OpenAI 兼容服务后即可生成日报。</span></div>
      <div v-else class="model-provider-list">
        <button v-for="provider in providers" :key="provider.id" type="button" class="model-provider-item" :class="{ selected: selectedProvider?.id === provider.id }" @click="selectProvider(provider)">
          <span><strong>{{ provider.name }}</strong><em v-if="provider.is_default">默认</em></span>
          <small>{{ provider.selected_model }}</small>
          <small>{{ provider.base_url }}</small>
        </button>
      </div>
    </aside>

    <section class="model-editor-panel">
      <div class="workspace-panel-header model-editor-header"><div><span class="eyebrow">OPENAI COMPATIBLE</span><h2>{{ selectedProvider ? '编辑模型配置' : '新建模型配置' }}</h2><p>密钥由服务端加密保存，管理端不会读取已保存的明文。</p></div><span v-if="selectedProvider?.is_default" class="default-badge"><CheckCircle2 :size="14" />自动日报默认配置</span></div>
      <div v-if="providerError" class="inline-error" role="alert">{{ providerError }}</div>
      <form class="model-form model-form-sticky-actions" @submit.prevent="saveProvider">
        <div class="model-form-grid"><label>配置名称<input v-model="providerForm.name" type="text" placeholder="例如：生产日报模型" required /></label><label>Base URL<input v-model="providerForm.baseUrl" type="url" placeholder="https://api.example.com/v1" required /><small>服务端会追加 /models 和 /chat/completions。</small></label></div>
        <div class="model-form-grid"><label>API Key<div class="secret-input"><KeyRound :size="16" /><input v-model="providerForm.apiKey" type="password" autocomplete="new-password" :required="!selectedProvider?.api_key_configured" :placeholder="selectedProvider?.api_key_configured ? `已保存 ${selectedProvider.api_key_hint}，留空不替换` : '输入 API Key'" /></div><small v-if="selectedProvider?.api_key_configured">已保存 {{ selectedProvider.api_key_hint }}；不会回显完整密钥。</small></label><div class="model-picker"><label>模型名称<input v-model="providerForm.selectedModel" type="text" list="available-models" placeholder="选择或输入模型标识" required /><datalist id="available-models"><option v-for="model in availableModels" :key="model.id" :value="model.id">{{ model.name }}</option></datalist></label><button class="secondary-button" type="button" :disabled="modelFetchLoading || !providerForm.baseUrl" @click="fetchModels"><RefreshCw :size="15" :class="{ spinning: modelFetchLoading }" /><span>{{ modelFetchLoading ? '拉取中' : '拉取模型' }}</span></button></div></div>
        <label class="checkbox-label"><input v-model="providerForm.isDefault" type="checkbox" /><span>设为自动日报默认模型</span></label>
        <div v-if="selectedProvider?.last_error" class="provider-health provider-health-error"><strong>最近拉取失败</strong><span>{{ selectedProvider.last_error }}</span></div>
        <div v-else-if="selectedProvider?.last_models_fetched_at" class="provider-health"><strong>模型列表已验证</strong><span>{{ new Date(selectedProvider.last_models_fetched_at).toLocaleString('zh-CN', { hour12: false }) }}</span></div>
        <div class="model-form-actions">
          <button v-if="selectedProvider" class="danger-button" type="button" :disabled="providerActionLoading" @click="deleteProvider"><Trash2 :size="15" />删除配置</button>
          <span></span>
          <button class="primary-button" type="submit" :disabled="providerActionLoading"><RefreshCw v-if="providerActionLoading" :size="15" class="spinning" /><Save v-else :size="15" /><span>{{ providerActionLoading ? '保存中' : '保存配置' }}</span></button>
        </div>
      </form>
    </section>
  </section>
</template>
