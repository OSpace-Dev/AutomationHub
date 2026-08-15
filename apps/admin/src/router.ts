import { createRouter, createWebHistory } from "vue-router";
import RunsView from "./views/RunsView.vue";
import DevicesView from "./views/DevicesView.vue";
import TasksView from "./views/TasksView.vue";
import MonitoringView from "./views/MonitoringView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/runs" },
    { path: "/runs", name: "runs", component: RunsView },
    { path: "/devices", name: "devices", component: DevicesView },
    { path: "/tasks", name: "tasks", component: TasksView },
    { path: "/monitoring", name: "monitoring", component: MonitoringView },
    { path: "/:pathMatch(.*)*", redirect: "/runs" }
  ]
});
