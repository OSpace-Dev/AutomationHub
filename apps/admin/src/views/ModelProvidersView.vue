<script setup lang="ts">
import { onMounted } from "vue";
import ProviderForm from "../domains/models/ProviderForm.vue";
import ProviderList from "../domains/models/ProviderList.vue";
import { useModelProvidersData } from "../useModelProvidersData";

const {
  providers,
  selectedProvider,
  providerLoading,
  providerActionLoading,
  providerError,
  availableModels,
  modelFetchLoading,
  providerForm,
  refreshProviders,
  selectProvider,
  newProvider,
  fetchModels,
  saveProvider,
  deleteProvider
} = useModelProvidersData();
onMounted(() => {
  void refreshProviders();
});
</script>

<template>
  <section class="models-workspace">
    <ProviderList
      :providers="providers"
      :selected-provider="selectedProvider"
      :loading="providerLoading"
      @new="newProvider"
      @select="selectProvider"
    />
    <ProviderForm
      :selected-provider="selectedProvider"
      :error="providerError"
      :available-models="availableModels"
      :model-fetch-loading="modelFetchLoading"
      :action-loading="providerActionLoading"
      :form="providerForm"
      @delete="deleteProvider"
      @fetch-models="fetchModels"
      @save="saveProvider"
    />
  </section>
</template>
