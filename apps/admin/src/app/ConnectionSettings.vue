<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { Server, X } from "lucide-vue-next";
import AdminKeyCard from "./AdminKeyCard.vue";

defineProps<{
  apiOrigin: string;
  apiKey: string;
  error: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:apiOrigin": [value: string];
  "update:apiKey": [value: string];
  connect: [];
  close: [];
}>();

const modalRef = ref<HTMLElement | null>(null);
let returnFocusTarget: HTMLElement | null = null;
let previousBodyOverflow = "";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(modalRef.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
    (element) => element.offsetParent !== null
  );
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(async () => {
  returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", handleKeydown);
  await nextTick();
  document.getElementById("connection-api-origin")?.focus();
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.body.style.overflow = previousBodyOverflow;
  returnFocusTarget?.focus();
  returnFocusTarget = null;
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <section
        ref="modalRef"
        class="connection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-settings-title"
      >
        <button
          class="icon-button connection-modal-close"
          type="button"
          title="关闭"
          aria-label="关闭"
          @click="emit('close')"
        >
          <X :size="19" aria-hidden="true" />
        </button>
        <AdminKeyCard
          title="管理 API 连接"
          heading-id="connection-settings-title"
          description="本地开发默认使用 localhost:3000，管理 Key 可留空。保存后即可继续读取管理端数据。"
          brand-subtitle="管理连接"
          :api-key="apiKey"
          :error="error"
          :loading="loading"
          submit-label="连接并读取"
          loading-label="连接中"
          autofocus
          @update:api-key="emit('update:apiKey', $event)"
          @submit="emit('connect')"
        >
          <template #extra-fields>
            <label class="auth-field" for="connection-api-origin">
              <span>API 地址</span>
              <div class="auth-input">
                <Server :size="17" class="auth-input-icon" aria-hidden="true" />
                <el-input
                  id="connection-api-origin"
                  :model-value="apiOrigin"
                  type="url"
                  autocomplete="url"
                  placeholder="http://localhost:3000"
                  :disabled="loading"
                  @update:model-value="emit('update:apiOrigin', $event)"
                />
              </div>
            </label>
          </template>
        </AdminKeyCard>
      </section>
    </div>
  </Teleport>
</template>
