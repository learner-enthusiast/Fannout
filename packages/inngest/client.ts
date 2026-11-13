import { Inngest } from "inngest";
import { env } from "./env";

/** The single Inngest client for the app. Use it to send events and define functions. */
export const inngest = new Inngest({
  id: env.INNGEST_APP_ID,
  // Dev server: INNGEST_DEV=1 (or URL) even when NODE_ENV=prod; else local = non-prod only.
  isDev: env.inngestDev || env.NODE_ENV !== "prod",
});
