export type DeviceStatus = "active" | "revoked";
export type RunStatus = "pending" | "running" | "completed" | "partial";
export type ItemStatus = "success" | "failed";
export type TaskType = "capture_trending";
export type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ScheduleRecurrence = "once" | "daily";
export type ScheduleStatus = "active" | "completed" | "cancelled";
export type RuntimeLogLevel = "info" | "warn" | "error";
export type ModelProviderStatus = "active" | "disabled";
export type ReportGenerationStatus = "pending" | "running" | "completed" | "failed";
export type ReportGenerationTrigger = "automatic" | "manual" | "retry";
export type ReportSourceType = "github_trending";
export type NotificationChannelType = "telegram";
export type ReportDeliveryStatus = "pending" | "sending" | "sent" | "failed";

export interface RegistrationCode {
  id: string;
  codeHash: string;
  codeHint?: string;
  createdAt?: string;
  expiresAt?: string;
  usedAt?: string;
  revokedAt?: string;
  deviceId?: string;
}

export interface Device {
  id: string;
  name: string;
  extensionVersion: string;
  registeredAt: string;
  lastHeartbeatAt?: string;
  queueDepth: number;
  status: DeviceStatus;
  revokedAt?: string;
  registrationCodeId?: string;
}

export interface DeviceToken {
  id: string;
  deviceId: string;
  tokenHash: string;
  kind: "access" | "refresh";
  expiresAt: string;
  revokedAt?: string;
}

export interface CollectionRun {
  id: string;
  deviceId: string;
  businessDate: string;
  sourceUrl: string;
  filters: Record<string, string>;
  idempotencyKey: string;
  status: RunStatus;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
}

export interface CollectionTask {
  id: string;
  deviceId: string;
  type: TaskType;
  status: TaskStatus;
  businessDate: string;
  idempotencyKey: string;
  runId?: string;
  createdAt: string;
  claimedAt?: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  errorCode?: string;
  scheduleId?: string;
}

export interface TaskSchedule {
  id: string;
  deviceId: string;
  type: TaskType;
  recurrence: ScheduleRecurrence;
  status: ScheduleStatus;
  startAt: string;
  nextRunAt?: string;
  timeZone: string;
  idempotencyKey: string;
  createdAt: string;
  lastTriggeredAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface RuntimeLog {
  id: string;
  deviceId: string;
  taskId?: string;
  level: RuntimeLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface ProjectSnapshot {
  id: string;
  runId: string;
  projectUrl: string;
  normalizedProjectUrl: string;
  rank: number;
  name: string;
  description?: string;
  language?: string;
  totalStars?: number;
  starsToday?: number;
  readmeHtml: string;
  readmeText: string;
  contentHash: string;
  readAt: string;
  status: ItemStatus;
  errorCode?: string;
}

export interface ReportProjectInsight {
  projectUrl: string;
  name: string;
  rank: number;
  category: string;
  purpose?: string;
  attentionReason?: string;
  description?: string;
  language?: string;
  totalStars?: number;
  starsToday?: number;
  totalStarsDelta?: number;
}

export interface ReportCategoryInsight {
  key: string;
  label: string;
  projectCount: number;
  totalStars?: number;
  starsToday?: number;
  projects: ReportProjectInsight[];
}

export interface ReportTrendProject {
  projectUrl: string;
  name: string;
  currentRank?: number;
  previousRank?: number;
  rankChange?: number;
  totalStarsDelta?: number;
}

export interface ReportInsights {
  presentationVersion?: 2;
  overview?: string;
  metrics: {
    projectCount: number;
    totalStars?: number;
    starsToday?: number;
    categoryCount: number;
    totalStarsDelta?: number;
    knownTotalStarsCount: number;
    knownStarsTodayCount: number;
    comparableProjectCount: number;
    analysisFallbackCount?: number;
  };
  categories: ReportCategoryInsight[];
  trends: {
    hasComparison: boolean;
    comparisonDate?: string;
    newEntries: ReportTrendProject[];
    continuedEntries: ReportTrendProject[];
    exitedEntries: ReportTrendProject[];
    risingEntries: ReportTrendProject[];
    fallingEntries: ReportTrendProject[];
    unchangedEntries: ReportTrendProject[];
  };
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  encryptedApiKey: string;
  apiKeyHint: string;
  selectedModel: string;
  isDefault: boolean;
  status: ModelProviderStatus;
  lastModelsFetchedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDefinition {
  id: string;
  type: string;
  name: string;
  sourceType: ReportSourceType;
  providerId?: string;
  promptTemplate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportGeneration {
  id: string;
  definitionId: string;
  sourceType: ReportSourceType;
  businessDate: string;
  runId: string;
  trigger: ReportGenerationTrigger;
  status: ReportGenerationStatus;
  providerName?: string;
  model?: string;
  inputItemCount: number;
  attemptCount: number;
  content?: string;
  insights?: ReportInsights;
  errorCode?: string;
  errorMessage?: string;
  parentGenerationId?: string;
  shareToken?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  encryptedBotToken: string;
  botTokenHint: string;
  proxyUrl?: string;
  encryptedProxyUrl?: string;
  proxyUrlHint?: string;
  proxyEnabled: boolean;
  botUsername?: string;
  botDisplayName?: string;
  enabled: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTarget {
  id: string;
  channelId: string;
  name: string;
  chatId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDelivery {
  id: string;
  reportGenerationId: string;
  channelId: string;
  targetId: string;
  status: ReportDeliveryStatus;
  attemptCount: number;
  messageCount?: number;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  sentAt?: string;
  completedAt?: string;
}

export interface StoreData {
  registrationCodes: RegistrationCode[];
  devices: Device[];
  tokens: DeviceToken[];
  runs: CollectionRun[];
  items: ProjectSnapshot[];
  tasks: CollectionTask[];
  schedules: TaskSchedule[];
  logs: RuntimeLog[];
  modelProviders: ModelProvider[];
  reportDefinitions: ReportDefinition[];
  reportGenerations: ReportGeneration[];
  notificationChannels: NotificationChannel[];
  notificationTargets: NotificationTarget[];
  reportDeliveries: ReportDelivery[];
}

export const EMPTY_STORE: StoreData = {
  registrationCodes: [],
  devices: [],
  tokens: [],
  runs: [],
  items: [],
  tasks: [],
  schedules: [],
  logs: [],
  modelProviders: [],
  reportDefinitions: [],
  reportGenerations: [],
  notificationChannels: [],
  notificationTargets: [],
  reportDeliveries: []
};
