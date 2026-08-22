import { createRouter, createWebHistory } from "vue-router";
import RunsView from "./views/RunsView.vue";
import DevicesView from "./views/DevicesView.vue";
import TasksView from "./views/TasksView.vue";
import MonitoringView from "./views/MonitoringView.vue";
import ReportsView from "./views/ReportsView.vue";
import ModelProvidersView from "./views/ModelProvidersView.vue";
import ChannelsView from "./views/ChannelsView.vue";
import PublicReportView from "./views/PublicReportView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/runs" },
    { path: "/runs", name: "runs", component: RunsView },
    { path: "/devices", name: "devices", component: DevicesView },
    { path: "/tasks", name: "tasks", component: TasksView },
    { path: "/monitoring", name: "monitoring", component: MonitoringView },
    { path: "/reports", name: "reports", component: ReportsView },
    { path: "/settings/models", name: "models", component: ModelProvidersView },
    { path: "/settings/channels", name: "channels", component: ChannelsView },
    { path: "/share/reports/:token", name: "public-report", component: PublicReportView },
    { path: "/:pathMatch(.*)*", redirect: "/runs" }
  ]
});
