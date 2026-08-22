<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { AlertCircle, ExternalLink, Maximize2, Minimize2, X } from "lucide-vue-next";
import type { Item, Status } from "../admin-models";

const props = defineProps<{
  item: Item;
  statusLabel: (status: Status) => string;
  formatTime: (value?: string) => string;
}>();

const emit = defineEmits<{ close: [] }>();
const fullscreen = ref(false);
const previewSrcdoc = computed(() => {
  if (!props.item.readmeHtml) return "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"><style>body{font:14px/1.65 system-ui,sans-serif;color:#25282b;padding:24px;max-width:920px;margin:auto}img{max-width:100%;height:auto}a{color:#1668c7}pre{overflow:auto;padding:12px;background:#f5f6f6}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:6px;border:1px solid #ddd}</style></head><body>${props.item.readmeHtml}</body></html>`;
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onUnmounted(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <section
        class="readme-modal"
        :class="{ fullscreen }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="readme-title"
      >
        <header>
          <div>
            <span>README 详情</span>
            <h2 id="readme-title">{{ item.name }}</h2>
          </div>
          <div class="modal-actions">
            <a
              class="icon-button"
              :href="item.projectUrl"
              target="_blank"
              rel="noreferrer"
              title="在 GitHub 打开"
              aria-label="在 GitHub 打开"
            >
              <ExternalLink :size="18" aria-hidden="true" />
            </a>
            <button
              class="icon-button"
              type="button"
              :title="fullscreen ? '退出全屏' : '全屏查看'"
              :aria-label="fullscreen ? '退出全屏' : '全屏查看'"
              @click="fullscreen = !fullscreen"
            >
              <Minimize2 v-if="fullscreen" :size="18" aria-hidden="true" />
              <Maximize2 v-else :size="18" aria-hidden="true" />
            </button>
            <button class="icon-button" type="button" title="关闭详情" aria-label="关闭详情" @click="emit('close')">
              <X :size="19" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div class="modal-meta">
          <span class="status" :data-status="item.status">{{ statusLabel(item.status) }}</span>
          <span>排名 #{{ item.rank }}</span>
          <span>{{ formatTime(item.readAt) }}</span>
          <span class="modal-url">{{ item.projectUrl }}</span>
        </div>
        <div class="modal-body">
          <div v-if="item.errorCode" class="modal-error">
            <AlertCircle :size="17" aria-hidden="true" />
            <span>读取失败：{{ item.errorCode }}</span>
          </div>
          <iframe
            v-if="previewSrcdoc"
            class="readme-frame"
            :srcdoc="previewSrcdoc"
            sandbox=""
            title="README 预览"
          ></iframe>
          <pre v-else class="readme-text">{{ item.readmeText || "没有可展示的 README 内容。" }}</pre>
        </div>
      </section>
    </div>
  </Teleport>
</template>
