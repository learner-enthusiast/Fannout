import { env } from "../env";
import { getValidAccessToken } from "../oauth";
import { getSocialConnectionById } from "../social-connections";
import { createProviderFactory } from "./factory";

export const providerFactory = createProviderFactory({
  getConnection: getSocialConnectionById,
  getValidAccessToken,
  facebook: { appSecret: env.FACEBOOK_CLIENT_SECRET, graphVersion: env.FACEBOOK_GRAPH_VERSION },
});

export const { createProviderForConnection, createYouTubeAnalyticsForConnection } = providerFactory;
export { createProviderFactory, CreateProviderInputSchema } from "./factory";
export type { CreateProviderInput, ProviderFactory, ProviderFactoryDeps } from "./factory";
