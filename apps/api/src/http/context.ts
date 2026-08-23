import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelProviderService } from "../application/model-provider-service.js";
import type { ReportDeliveryService } from "../application/report-delivery-service.js";
import type { ReportGenerationService } from "../application/report-generation-service.js";
import type { CollectionService } from "../application/collection-service.js";
import type { ServerOptions } from "./server.js";
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
