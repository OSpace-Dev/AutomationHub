<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    page: number;
    totalPages: number;
    total: number;
    itemLabel?: string;
  }>(),
  {
    itemLabel: "条"
  }
);

const emit = defineEmits<{
  change: [page: number];
}>();

const pageDraft = ref(String(props.page));
const targetPage = computed(() => {
  const parsed = Number(pageDraft.value);
  if (!Number.isInteger(parsed)) return null;
  return Math.min(Math.max(parsed, 1), props.totalPages);
});
const canJump = computed(() => targetPage.value !== null && targetPage.value !== props.page);

watch(
  () => props.page,
  (page) => {
    pageDraft.value = String(page);
  }
);

function changePage(page: number) {
  const target = Math.min(Math.max(page, 1), props.totalPages);
  pageDraft.value = String(target);
  if (target !== props.page) emit("change", target);
}

function jumpToDraftPage() {
  if (targetPage.value === null) {
    pageDraft.value = String(props.page);
    return;
  }
  changePage(targetPage.value);
}
</script>

<template>
  <nav class="pagination-bar" aria-label="分页导航">
    <span>共 {{ total }} {{ itemLabel }} · 第 {{ page }} / {{ totalPages }} 页</span>
    <div class="pagination-actions">
      <button
        class="icon-button"
        type="button"
        title="上一页"
        aria-label="上一页"
        :disabled="page <= 1"
        @click="changePage(page - 1)"
      >
        <ChevronLeft :size="15" aria-hidden="true" />
      </button>
      <label class="pagination-jump">
        <span class="sr-only">跳转页码</span>
        <input
          v-model="pageDraft"
          type="number"
          inputmode="numeric"
          min="1"
          :max="totalPages"
          aria-label="跳转页码"
          @keydown.enter.prevent="jumpToDraftPage"
        />
      </label>
      <button
        class="secondary-button pagination-jump-button"
        type="button"
        :disabled="!canJump"
        @click="jumpToDraftPage"
      >
        跳转
      </button>
      <button
        class="icon-button"
        type="button"
        title="下一页"
        aria-label="下一页"
        :disabled="page >= totalPages"
        @click="changePage(page + 1)"
      >
        <ChevronRight :size="15" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>
