import express from "express";
import { logger } from "@repo/logger";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import * as trpcExpress from "@trpc/server/adapters/express";
import { generateOpenApiDocument, createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { apiReference } from "@scalar/express-api-reference";

import { serverRouter, createContext } from "@repo/trpc/server";
import helmet from "helmet";
import { env } from "./env";
import { errorHandler } from "./middleware/error-handler";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { createDefaultOAuthRouter } from "./routes/oauth";
import { inngestHandler } from "@repo/inngest";
import { loggableUrl } from "./utils/safe-url";

export const app = express();
const openApiDocument = generateOpenApiDocument(serverRouter, {
  title: "Fannout OpenAPI",
  version: "1.0.0",
  baseUrl: env.BASE_URL.concat("/api"),
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

app.get("/health", (req, res) => {
  return res.json({ message: "Fannout API is healthy", healthy: true });
});

logger.debug(`openapi.json: ${env.BASE_URL}/openapi.json`);
app.get("/openapi.json", (req, res) => {
  return res.json(openApiDocument);
});

logger.debug(`docs: ${env.BASE_URL}/docs`);
app.use("/docs", apiReference({ url: "/openapi.json" }));

// Plain Express routes (browser redirects); must be mounted before the OpenAPI catch-all.
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
