import { Inngest } from "inngest";
import { env } from "./env";

/** The single Inngest client for the app. Use it to send events and define functions. */
export const inngest = new Inngest({
  id: env.INNGEST_APP_ID,
  // Local: talk to the Inngest Dev Server (npx inngest-cli@latest dev).
  isDev: env.NODE_ENV !== "prod",
});
