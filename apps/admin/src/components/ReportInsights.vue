<script setup lang="ts">
import { ExternalLink, FolderOpen, Sparkles } from "lucide-vue-next";
import { computed } from "vue";
import type { ReportInsights, ReportProjectInsight } from "../admin-models";
import MarkdownContent from "./MarkdownContent.vue";

interface ProjectTag {
  text: string;
  tone?: "accent" | "positive" | "negative";
}

const props = defineProps<{ insights: ReportInsights }>();

const overviewText = computed(() => props.insights.overview?.trim() || buildFallbackOverview());
const overviewFacts = computed(() => {
  const facts = [
    `${props.insights.metrics.project_count} 个项目`,
    `${props.insights.metrics.category_count} 个分类`
  ];
  if (props.insights.metrics.stars_today !== undefined) facts.push(`今日 +${formatNumber(props.insights.metrics.stars_today)} Star`);
  if ((props.insights.metrics.analysis_fallback_count ?? 0) > 0) {
    facts.push(`${props.insights.metrics.analysis_fallback_count} 个项目使用降级分析`);
  }
  if (props.insights.trends.has_comparison) {
    facts.push(`新上榜 ${props.insights.trends.new_entries.length}`);
    facts.push(`退出榜单 ${props.insights.trends.exited_entries.length}`);
  }
  return facts;
});
const trendByProject = computed(() => {
  const values = new Map<string, ProjectTag>();
  for (const project of props.insights.trends.new_entries) values.set(normalizeUrl(project.project_url), { text: "新上榜", tone: "accent" });
  for (const project of props.insights.trends.rising_entries) values.set(normalizeUrl(project.project_url), { text: `排名 ↑${project.rank_change ?? 0}`, tone: "positive" });
  for (const project of props.insights.trends.falling_entries) values.set(normalizeUrl(project.project_url), { text: `排名 ↓${Math.abs(project.rank_change ?? 0)}`, tone: "negative" });
  return values;
});

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function projectSummary(project: ReportProjectInsight) {
  const purpose = cleanSummarySegment(project.purpose?.trim() || project.description?.trim() || `${project.name} 的项目说明暂未完整采集。`);
  const attention = cleanSummarySegment(project.attention_reason?.trim());
  if (!attention || isRepeatedSummary(purpose, attention)) return finishSentence(purpose);
  return `${finishSentence(purpose)}${finishSentence(attention)}`;
}

function cleanSummarySegment(value: string | undefined) {
  return value?.replace(/\s+/g, " ").replace(/^(用途|值得关注)\s*[：:]\s*/u, "").trim() || "";
}

function finishSentence(value: string) {
  return /[。！？.!?]$/u.test(value) ? value : `${value}。`;
}

function isRepeatedSummary(first: string, second: string) {
  const normalizedFirst = first.replace(/[。！？.!?，,、\s]/gu, "").toLocaleLowerCase();
  const normalizedSecond = second.replace(/[。！？.!?，,、\s]/gu, "").toLocaleLowerCase();
  return normalizedFirst === normalizedSecond
    || normalizedFirst.includes(normalizedSecond)
    || normalizedSecond.includes(normalizedFirst);
}

function projectTags(project: ReportProjectInsight): ProjectTag[] {
  const tags: ProjectTag[] = [{ text: `#${project.rank}` }];
  if (project.language) tags.push({ text: project.language });
  if (project.total_stars !== undefined) tags.push({ text: `${formatNumber(project.total_stars)} Star` });
  if (project.stars_today !== undefined) tags.push({ text: `今日 +${formatNumber(project.stars_today)}`, tone: "accent" });
  const trend = trendByProject.value.get(normalizeUrl(project.project_url));
  if (trend) tags.push(trend);
  return tags;
}

function categoryMeta(starsToday?: number) {
  return starsToday === undefined ? "" : `今日 +${formatNumber(starsToday)} Star`;
}

function buildFallbackOverview() {
  const categoryNames = props.insights.categories.slice(0, 3).map((category) => category.label);
  const categoryText = categoryNames.length ? `，主要集中于${categoryNames.join("、")}` : "";
  return `今天共收录 ${props.insights.metrics.project_count} 个 GitHub Trending 项目，覆盖 ${props.insights.metrics.category_count} 个主题${categoryText}。`;
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "").toLowerCase();
}
</script>

<template>
  <section class="report-insights" aria-label="日报内容">
    <section class="report-overview-card">
      <header>
        <div class="report-section-icon"><Sparkles :size="17" aria-hidden="true" /></div>
        <div><span class="eyebrow">TODAY</span><h3>今日概览</h3></div>
      </header>
      <MarkdownContent :content="overviewText" />
      <div class="report-overview-facts" aria-label="今日辅助数据">
        <span v-for="fact in overviewFacts" :key="fact">{{ fact }}</span>
        <span v-if="insights.trends.has_comparison && insights.trends.comparison_date">对比 {{ insights.trends.comparison_date }}</span>
      </div>
    </section>

    <div class="report-category-list">
      <section v-for="category in insights.categories" :key="category.key" class="report-category-section">
        <header class="report-category-header">
          <div class="report-category-title">
            <span class="report-section-icon subtle"><FolderOpen :size="16" aria-hidden="true" /></span>
            <div><h3>{{ category.label }}</h3><span>{{ category.project_count }} 个项目</span></div>
          </div>
          <span v-if="categoryMeta(category.stars_today)" class="report-category-meta">{{ categoryMeta(category.stars_today) }}</span>
        </header>

        <div class="report-project-grid">
          <article v-for="project in category.projects" :key="project.project_url" class="report-project-card">
            <header>
              <a :href="project.project_url" target="_blank" rel="noopener noreferrer">
                <span>{{ project.name }}</span>
                <ExternalLink :size="15" aria-hidden="true" />
              </a>
            </header>

            <p class="report-project-summary">{{ projectSummary(project) }}</p>

            <footer class="report-project-tags" aria-label="项目辅助数据">
              <span v-for="tag in projectTags(project)" :key="`${project.project_url}-${tag.text}`" :data-tone="tag.tone">{{ tag.text }}</span>
            </footer>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
