<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

const props = defineProps<{ content?: string }>();

const renderedContent = computed(() => {
  const markdown = props.content?.trim();
  if (!markdown) return "";
  const parsed = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(parsed, { USE_PROFILES: { html: true } });
});

function openExternalLink(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest("a");
  if (!(link instanceof HTMLAnchorElement)) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin === window.location.origin) return;
  event.preventDefault();
  window.open(target.href, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <article v-if="renderedContent" class="markdown-content" @click="openExternalLink" v-html="renderedContent"></article>
  <div v-else class="markdown-empty">这份日报没有可展示的正文。</div>
</template>
