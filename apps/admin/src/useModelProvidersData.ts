import { ref } from "vue";
import type { ModelDescriptor, ModelProvider } from "./admin-models";
import { apiFetch } from "./useAdminData";

const providers = ref<ModelProvider[]>([]);
const selectedProvider = ref<ModelProvider | null>(null);
const providerLoading = ref(false);
const providerActionLoading = ref(false);
const providerError = ref("");
const availableModels = ref<ModelDescriptor[]>([]);
const modelFetchLoading = ref(false);
const providerForm = ref({ name: "", baseUrl: "", apiKey: "", selectedModel: "", isDefault: true });

export function useModelProvidersData() {
  return { providers, selectedProvider, providerLoading, providerActionLoading, providerError, availableModels, modelFetchLoading, providerForm, refreshProviders, selectProvider, newProvider, fetchModels, saveProvider, deleteProvider };
}

async function refreshProviders() {
  providerLoading.value = true;
  providerError.value = "";
  try {
    const response = await apiFetch<ModelProvider[]>("/api/v1/admin/model-providers");
    providers.value = response.data;
    if (selectedProvider.value) {
      const latest = providers.value.find((entry) => entry.id === selectedProvider.value?.id);
      if (latest) selectProvider(latest);
    } else if (providers.value[0]) {
      selectProvider(providers.value[0]);
    }
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : "模型配置读取失败。";
  } finally {
    providerLoading.value = false;
  }
}

function selectProvider(provider: ModelProvider) {
  selectedProvider.value = provider;
  providerForm.value = { name: provider.name, baseUrl: provider.base_url, apiKey: "", selectedModel: provider.selected_model, isDefault: provider.is_default };
  availableModels.value = [];
}

function newProvider() {
  selectedProvider.value = null;
  providerForm.value = { name: "", baseUrl: "", apiKey: "", selectedModel: "", isDefault: providers.value.length === 0 };
  availableModels.value = [];
  providerError.value = "";
}

async function fetchModels() {
  modelFetchLoading.value = true;
  providerError.value = "";
  try {
    const response = await apiFetch<ModelDescriptor[]>("/api/v1/admin/model-providers/models:fetch", {
      method: "POST",
      body: JSON.stringify({
        provider_id: selectedProvider.value?.id,
        base_url: providerForm.value.baseUrl,
        api_key: providerForm.value.apiKey || undefined
      })
    });
    availableModels.value = response.data;
    if (!providerForm.value.selectedModel && response.data[0]) providerForm.value.selectedModel = response.data[0].id;
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : "模型列表拉取失败，可手动填写模型名称。";
  } finally {
    modelFetchLoading.value = false;
  }
}

async function saveProvider() {
  providerActionLoading.value = true;
  providerError.value = "";
  try {
    const body: Record<string, unknown> = { name: providerForm.value.name, base_url: providerForm.value.baseUrl, selected_model: providerForm.value.selectedModel, is_default: providerForm.value.isDefault };
    if (providerForm.value.apiKey) body.api_key = providerForm.value.apiKey;
    const response = selectedProvider.value
      ? await apiFetch<ModelProvider>(`/api/v1/admin/model-providers/${encodeURIComponent(selectedProvider.value.id)}`, { method: "PUT", body: JSON.stringify(body) })
      : await apiFetch<ModelProvider>("/api/v1/admin/model-providers", { method: "POST", body: JSON.stringify({ ...body, api_key: providerForm.value.apiKey }) });
    await refreshProviders();
    const saved = providers.value.find((entry) => entry.id === response.data.id) ?? response.data;
    selectProvider(saved);
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : "模型配置保存失败。";
  } finally {
    providerActionLoading.value = false;
  }
}

async function deleteProvider() {
  if (!selectedProvider.value || !window.confirm("删除后自动日报会暂停，但历史日报仍会保留。确认删除吗？")) return;
  providerActionLoading.value = true;
  providerError.value = "";
  try {
    await apiFetch(`/api/v1/admin/model-providers/${encodeURIComponent(selectedProvider.value.id)}`, { method: "DELETE" });
    newProvider();
    await refreshProviders();
  } catch (error) {
    providerError.value = error instanceof Error ? error.message : "模型配置删除失败。";
  } finally {
    providerActionLoading.value = false;
  }
}
