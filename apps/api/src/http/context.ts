import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelProviderService } from "../model-service.js";
import type { ReportDeliveryService } from "../notification-service.js";
import type { ReportGenerationService } from "../report-service.js";
import type { CollectionService } from "../service.js";
import type { ServerOptions } from "../server.js";
import type { AuthContext } from "./auth.js";

export interface HttpContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  service: CollectionService;
  providers: ModelProviderService;
  reports: ReportGenerationService;
  deliveries: ReportDeliveryService;
  options: ServerOptions;
  auth?: AuthContext;
}
