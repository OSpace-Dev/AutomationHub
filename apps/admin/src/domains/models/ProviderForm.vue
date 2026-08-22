<script setup lang="ts">
import { CheckCircle2, KeyRound, RefreshCw, Save, Trash2 } from "lucide-vue-next";
import type { ModelDescriptor, ModelProvider } from "../../admin-models";

interface ProviderFormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  selectedModel: string;
  isDefault: boolean;
}

defineProps<{
  selectedProvider: ModelProvider | null;
  error: string;
  availableModels: ModelDescriptor[];
  modelFetchLoading: boolean;
  actionLoading: boolean;
  form: ProviderFormState;
}>();

const emit = defineEmits<{
  delete: [];
  fetchModels: [];
  save: [];
}>();
</script>

<template>
  <section class="model-editor-panel">
    <div class="workspace-panel-header model-editor-header">
      <div>
        <span class="eyebrow">OPENAI COMPATIBLE</span>
        <h2>{{ selectedProvider ? "编辑模型配置" : "新建模型配置" }}</h2>
        <p>密钥由服务端加密保存，管理端不会读取已保存的明文。</p>
      </div>
      <span v-if="selectedProvider?.is_default" class="default-badge"><CheckCircle2 :size="14" />自动日报默认配置</span>
    </div>
    <div v-if="error" class="inline-error" role="alert">{{ error }}</div>
    <form class="model-form model-form-sticky-actions" @submit.prevent="emit('save')">
      <div class="model-form-grid">
        <label>配置名称<input v-model="form.name" type="text" placeholder="例如：生产日报模型" required /></label
        ><label
          >Base URL<input v-model="form.baseUrl" type="url" placeholder="https://api.example.com/v1" required /><small
            >服务端会追加 /models 和 /chat/completions。</small
          ></label
        >
      </div>
      <div class="model-form-grid">
        <label
          >API Key
          <div class="secret-input">
            <KeyRound :size="16" /><input
              v-model="form.apiKey"
              type="password"
              autocomplete="new-password"
              :required="!selectedProvider?.api_key_configured"
              :placeholder="
                selectedProvider?.api_key_configured
                  ? `已保存 ${selectedProvider.api_key_hint}，留空不替换`
                  : '输入 API Key'
              "
            />
          </div>
          <small v-if="selectedProvider?.api_key_configured"
            >已保存 {{ selectedProvider.api_key_hint }}；不会回显完整密钥。</small
          ></label
        >
        <div class="model-picker">
          <label>
            模型名称
            <el-select
              v-model="form.selectedModel"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入模型标识"
              no-data-text="请先拉取模型，或直接输入模型标识"
            >
              <el-option
                v-for="model in availableModels"
                :key="model.id"
                :label="model.name || model.id"
                :value="model.id"
              />
            </el-select>
          </label>
          <button
            class="secondary-button"
            type="button"
            :disabled="modelFetchLoading || !form.baseUrl"
            @click="emit('fetchModels')"
          >
            <RefreshCw :size="15" :class="{ spinning: modelFetchLoading }" /><span>{{
              modelFetchLoading ? "拉取中" : "拉取模型"
            }}</span>
          </button>
        </div>
      </div>
      <label class="checkbox-label"
        ><input v-model="form.isDefault" type="checkbox" /><span>设为自动日报默认模型</span></label
      >
      <div v-if="selectedProvider?.last_error" class="provider-health provider-health-error">
        <strong>最近拉取失败</strong><span>{{ selectedProvider.last_error }}</span>
      </div>
      <div v-else-if="selectedProvider?.last_models_fetched_at" class="provider-health">
        <strong>模型列表已验证</strong
        ><span>{{ new Date(selectedProvider.last_models_fetched_at).toLocaleString("zh-CN", { hour12: false }) }}</span>
      </div>
      <div class="model-form-actions">
        <button
          v-if="selectedProvider"
          class="danger-button"
          type="button"
          :disabled="actionLoading"
          @click="emit('delete')"
        >
          <Trash2 :size="15" />删除配置
        </button>
        <span></span>
        <button class="primary-button" type="submit" :disabled="actionLoading || !form.selectedModel.trim()">
          <RefreshCw v-if="actionLoading" :size="15" class="spinning" /><Save v-else :size="15" /><span>{{
            actionLoading ? "保存中" : "保存配置"
          }}</span>
        </button>
      </div>
    </form>
  </section>
</template>
