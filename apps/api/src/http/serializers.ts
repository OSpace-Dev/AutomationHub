import type { ReportInsights } from "../domain/models.js";

export function serializeReportInsights(insights: ReportInsights) {
  const serializeProject = (project: ReportInsights["categories"][number]["projects"][number]) => ({
    project_url: project.projectUrl,
    name: project.name,
    rank: project.rank,
    category: project.category,
    purpose: project.purpose,
    attention_reason: project.attentionReason,
    description: project.description,
    language: project.language,
    total_stars: project.totalStars,
    stars_today: project.starsToday,
    total_stars_delta: project.totalStarsDelta
  });
  const serializeTrend = (project: ReportInsights["trends"]["newEntries"][number]) => ({
    project_url: project.projectUrl,
    name: project.name,
    current_rank: project.currentRank,
    previous_rank: project.previousRank,
    rank_change: project.rankChange,
    total_stars_delta: project.totalStarsDelta
  });
  return {
    presentation_version: insights.presentationVersion,
    overview: insights.overview,
    metrics: {
      project_count: insights.metrics.projectCount,
      total_stars: insights.metrics.totalStars,
      stars_today: insights.metrics.starsToday,
      category_count: insights.metrics.categoryCount,
      total_stars_delta: insights.metrics.totalStarsDelta,
      known_total_stars_count: insights.metrics.knownTotalStarsCount,
      known_stars_today_count: insights.metrics.knownStarsTodayCount,
      comparable_project_count: insights.metrics.comparableProjectCount,
      analysis_fallback_count: insights.metrics.analysisFallbackCount
    },
    categories: insights.categories.map((category) => ({
      key: category.key,
      label: category.label,
      project_count: category.projectCount,
      total_stars: category.totalStars,
      stars_today: category.starsToday,
      projects: category.projects.map(serializeProject)
    })),
    trends: {
      has_comparison: insights.trends.hasComparison,
      comparison_date: insights.trends.comparisonDate,
      new_entries: insights.trends.newEntries.map(serializeTrend),
      continued_entries: insights.trends.continuedEntries.map(serializeTrend),
      exited_entries: insights.trends.exitedEntries.map(serializeTrend),
      rising_entries: insights.trends.risingEntries.map(serializeTrend),
      falling_entries: insights.trends.fallingEntries.map(serializeTrend),
      unchanged_entries: insights.trends.unchangedEntries.map(serializeTrend)
    }
  };
}
