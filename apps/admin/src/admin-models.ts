export type Status =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "partial"
  | "active"
  | "used"
  | "expired"
  | "revoked"
  | "cancelled";
export type ConnectionState = "disconnected" | "connecting" | "online" | "error";

export interface Run {
  id: string;
  businessDate: string;
  deviceId: string;
  sourceUrl: string;
  status: Status;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
}
export interface Item {
  id: string;
  projectUrl: string;
  rank: number;
  name: string;
  description?: string;
  language?: string;
  totalStars?: number;
  starsToday?: number;
  readmeHtml: string;
  readmeText: string;
  status: Status;
  errorCode?: string;
  readAt: string;
}
export interface Device {
  id: string;
  name: string;
  extension_version: string;
  registered_at: string;
  last_heartbeat_at?: string;
  queue_depth: number;
  status: Status;
}
export interface Task {
  id: string;
  device_id: string;
  type: string;
  status: Status;
  business_date: string;
  run_id?: string;
  schedule_id?: string;
  created_at: string;
  claimed_at?: string;
  completed_at?: string;
  error_code?: string;
}
export interface DeviceAuthorization {
  id: string;
  code_hint: string;
  status: Status;
  created_at?: string;
  expires_at?: string;
  used_at?: string;
  device_id?: string;
}
export interface TaskSchedule {
  id: string;
  device_id: string;
  type: string;
  recurrence: "once" | "daily";
  status: Status;
  start_at: string;
  next_run_at?: string;
  time_zone: string;
  created_at: string;
  last_triggered_at?: string;
  completed_at?: string;
  cancelled_at?: string;
}
export interface RuntimeLog {
  id: string;
  device_id: string;
  task_id?: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
  occurred_at: string;
}
export interface PageMeta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
export interface ApiResponse<T> {
  data: T;
  meta?: PageMeta;
  message?: string;
  code?: string;
}
export interface ModelProvider {
  id: string;
  name: string;
  base_url: string;
  api_key_configured: boolean;
  api_key_hint: string;
  selected_model: string;
  is_default: boolean;
  status: "active" | "disabled";
  last_models_fetched_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}
export interface ModelDescriptor {
  id: string;
  name?: string;
}
export type ReportStatus = "pending" | "running" | "completed" | "failed";
export interface ReportProjectInsight {
  project_url: string;
  name: string;
  rank: number;
  category: string;
  purpose?: string;
  attention_reason?: string;
  description?: string;
  language?: string;
  total_stars?: number;
  stars_today?: number;
  total_stars_delta?: number;
}
export interface ReportCategoryInsight {
  key: string;
  label: string;
  project_count: number;
  total_stars?: number;
  stars_today?: number;
  projects: ReportProjectInsight[];
}
export interface ReportTrendProject {
  project_url: string;
  name: string;
  current_rank?: number;
  previous_rank?: number;
  rank_change?: number;
  total_stars_delta?: number;
}
export interface ReportInsights {
  presentation_version?: 2;
  overview?: string;
  metrics: {
    project_count: number;
    total_stars?: number;
    stars_today?: number;
    category_count: number;
    total_stars_delta?: number;
    known_total_stars_count: number;
    known_stars_today_count: number;
    comparable_project_count: number;
    analysis_fallback_count?: number;
  };
  categories: ReportCategoryInsight[];
  trends: {
    has_comparison: boolean;
    comparison_date?: string;
    new_entries: ReportTrendProject[];
    continued_entries: ReportTrendProject[];
    exited_entries: ReportTrendProject[];
    rising_entries: ReportTrendProject[];
    falling_entries: ReportTrendProject[];
    unchanged_entries: ReportTrendProject[];
  };
}
export interface ReportGeneration {
  id: string;
  definition_id: string;
  source_type: string;
  business_date: string;
  run_id: string;
  trigger: "automatic" | "manual" | "retry";
  status: ReportStatus;
  provider_name?: string;
  model?: string;
  input_item_count: number;
  attempt_count: number;
  content?: string;
  insights?: ReportInsights;
  error_code?: string;
  error_message?: string;
  parent_generation_id?: string;
  public_url?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}
export interface NotificationChannel {
  id: string;
  type: "telegram";
  name: string;
  bot_token_configured: boolean;
  bot_token_hint: string;
  proxy_configured: boolean;
  proxy_url_hint?: string;
  proxy_enabled: boolean;
  bot_username?: string;
  bot_display_name?: string;
  enabled: boolean;
  last_verified_at?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}
export interface TelegramChat {
  id: string;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  already_configured: boolean;
}
export interface NotificationTarget {
  id: string;
  channel_id: string;
  name: string;
  chat_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
export type ReportDeliveryStatus = "pending" | "sending" | "sent" | "failed";
export interface ReportDelivery {
  id: string;
  report_generation_id: string;
  channel_id: string;
  channel_name?: string;
  target_id: string;
  target_name?: string;
  chat_id?: string;
  status: ReportDeliveryStatus;
  attempt_count: number;
  message_count?: number;
  last_error?: string;
  created_at: string;
  started_at?: string;
  sent_at?: string;
  completed_at?: string;
}
export interface PublicReport {
  business_date: string;
  source_type: string;
  content: string;
  insights?: ReportInsights;
  completed_at?: string;
}
