import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/runs" },
    { path: "/runs", name: "runs", component: () => import("./views/RunsView.vue") },
    { path: "/devices", name: "devices", component: () => import("./views/DevicesView.vue") },
    { path: "/tasks", name: "tasks", component: () => import("./views/TasksView.vue") },
    { path: "/monitoring", name: "monitoring", component: () => import("./views/MonitoringView.vue") },
    { path: "/reports", name: "reports", component: () => import("./views/ReportsView.vue") },
    { path: "/settings/models", name: "models", component: () => import("./views/ModelProvidersView.vue") },
    { path: "/settings/channels", name: "channels", component: () => import("./views/ChannelsView.vue") },
    {
      path: "/share/reports/:token",
      name: "public-report",
      component: () => import("./views/PublicReportView.vue")
    },
    { path: "/:pathMatch(.*)*", redirect: "/runs" }
  ]
});
