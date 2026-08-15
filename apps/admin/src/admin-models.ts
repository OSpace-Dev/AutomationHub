export type Status = "success" | "failed" | "pending" | "running" | "paused" | "completed" | "partial" | "active" | "used" | "expired" | "revoked" | "cancelled";
export type ConnectionState = "disconnected" | "connecting" | "online" | "error";

export interface Run { id: string; businessDate: string; deviceId: string; sourceUrl: string; status: Status; itemCount: number; successCount: number; failureCount: number; createdAt: string; }
export interface Item { id: string; projectUrl: string; rank: number; name: string; readmeHtml: string; readmeText: string; status: Status; errorCode?: string; readAt: string; }
export interface Device { id: string; name: string; extension_version: string; registered_at: string; last_heartbeat_at?: string; queue_depth: number; status: Status; }
export interface Task { id: string; device_id: string; type: string; status: Status; business_date: string; run_id?: string; schedule_id?: string; created_at: string; claimed_at?: string; completed_at?: string; error_code?: string; }
export interface DeviceAuthorization { id: string; code_hint: string; status: Status; created_at?: string; expires_at?: string; used_at?: string; device_id?: string; }
export interface TaskSchedule { id: string; device_id: string; type: string; recurrence: "once" | "daily"; status: Status; start_at: string; next_run_at?: string; time_zone: string; created_at: string; last_triggered_at?: string; completed_at?: string; cancelled_at?: string; }
export interface RuntimeLog { id: string; device_id: string; task_id?: string; level: "info" | "warn" | "error"; event: string; message: string; metadata?: Record<string, unknown>; occurred_at: string; }
export interface PageMeta { total: number; page: number; page_size: number; total_pages: number; }
export interface ApiResponse<T> { data: T; meta?: PageMeta; message?: string; code?: string; }
