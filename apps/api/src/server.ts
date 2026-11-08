import express from "express";
import { logger } from "@repo/logger";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import * as trpcExpress from "@trpc/server/adapters/express";
import { generateOpenApiDocument, createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { apiReference } from "@scalar/express-api-reference";

import { serverRouter, createContext } from "@repo/trpc/server";
import { expressRateLimit } from "@repo/services/rate-limit/rate-limiter";
import helmet from "helmet";
import { env } from "./env";
import { errorHandler } from "./middleware/error-handler";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { createDefaultOAuthRouter } from "./routes/oauth";
import { inngestHandler } from "@repo/inngest";
import { loggableUrl } from "./utils/safe-url";
import { agentGuide } from "./generated/agent-guide";
import { probeDependencies } from "@repo/services/health";
import { API_DEPENDENCIES } from "./startup/check-connections";

export const app = express();
const openApiDocument = generateOpenApiDocument(serverRouter, {
  title: "Fannout OpenAPI",
  version: "1.0.0",
  baseUrl: env.BASE_URL.concat("/api"),
  description:
    "Authenticate with an API key from Settings → API keys: `Authorization: Bearer fn_live_…`. " +
    "Every API-key response carries X-RateLimit-Limit / -Remaining / -Reset; 429 adds Retry-After.",
  securitySchemes: {
    ApiKey: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "fn_live_<32 chars>",
      description: "Personal API key (Settings → API keys). Scopes limit what it can do.",
    },
  },
});

app.use(clerkMiddleware());
app.use(
  cors({
    origin: env.WEB_URL,
    credentials: true,
  }),
);
app.post("/webhooks/clerk", express.raw({ type: "application/json" }), clerkWebhookHandler);
// Inngest sends large step payloads; give it its own parser ahead of the global 100kb one.
// Inngest holds the connection open while one step runs. Node's requestTimeout/headersTimeout only
// cover *receiving* the (small) request, and the socket idle timeout defaults to off — but a step
// can be silent for minutes while it uploads, so make "no idle timeout" explicit for this route
// only. Uploads must not depend on this: they're chunked into ≤ ~60 s steps (publishing/upload).
app.use("/api/inngest", (req, _res, next) => {
  req.setTimeout(0);
  next();
});
app.use("/api/inngest", express.json({ limit: "10mb" }), inngestHandler);
app.use(
  helmet({
    contentSecurityPolicy: false,

    crossOriginEmbedderPolicy: false,

    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },

    hsts:
      env.NODE_ENV === "prod"
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
  }),
);
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    logger.info(`${req.method} ${loggableUrl(req)} -> ${res.statusCode}`, {
      durationMs: Date.now() - start,
    });
  });

  next();
});
app.get("/", (req, res) => {
  return res.json({ message: "Fannout API is up and running..." });
});

// Liveness + readiness: 200 when every dependency answers, 503 (with which one failed) otherwise.
app.get("/health", async (_req, res) => {
  const dependencies = await probeDependencies(API_DEPENDENCIES);
  const healthy = dependencies.every((d) => d.healthy);
  res.set("Cache-Control", "no-store");
  return res.status(healthy ? 200 : 503).json({
    message: healthy ? "Fannout API is healthy" : "Fannout API is degraded",
    healthy,
    dependencies,
  });
});

// Public, static agent discovery documents. The source is generated alongside
// docs/ai.md so the deployed copy exactly matches the checked-in contract.
app.get("/ai.md", (_req, res) => {
  res.set({ "Cache-Control": "public, max-age=300", "Content-Type": "text/markdown; charset=utf-8" });
  return res.send(agentGuide);
});

app.get("/llms.txt", (_req, res) => {
  res.set({ "Cache-Control": "public, max-age=300", "Content-Type": "text/plain; charset=utf-8" });
  return res.send("# Fannout API\n\nAgent guide: /ai.md\nOpenAPI: /openapi.json\n");
});

logger.debug(`openapi.json: ${env.BASE_URL}/openapi.json`);
app.get("/openapi.json", (req, res) => {
  return res.json(openApiDocument);
});

logger.debug(`docs: ${env.BASE_URL}/docs`);
app.use("/docs", apiReference({ url: "/openapi.json" }));

// Plain Express routes (browser redirects); must be mounted before the OpenAPI catch-all.
// Non-tRPC routes get the same limiter via its Express middleware (keyed by IP here).
app.use(
  "/api/oauth/:provider/connect",
  expressRateLimit("api", (req) => req.ip ?? null, { session: true }),
);
app.use(
  "/api/oauth",
  createDefaultOAuthRouter({ webUrl: env.WEB_URL, secureCookies: env.NODE_ENV === "prod" }),
);

app.use(
  "/api",
  createOpenApiExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

app.use(
  "/trpc",
  trpcExpress.createExpressMiddleware({
    router: serverRouter,
    createContext,
  }),
);

app.use(errorHandler);

export default app;
