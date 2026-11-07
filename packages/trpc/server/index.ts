import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { usersRouter } from "./routes/users/route";
import { socialConnectionsRouter } from "./routes/social-connections/route";
import { mediaRouter } from "./routes/media/route";
import { notificationsRouter } from "./routes/notifications/route";
import { foldersRouter } from "./routes/folders/route";
import { searchRouter } from "./routes/search/route";
import { platformsRouter } from "./routes/platforms/route";
import { postsRouter } from "./routes/posts/route";
import { aiRouter } from "./routes/ai/route";
import { apiKeysRouter } from "./routes/api-keys/route";

export const serverRouter = router({
  health: healthRouter,
  users: usersRouter,
  socialConnections: socialConnectionsRouter,
  media: mediaRouter,
  notifications: notificationsRouter,
  folders: foldersRouter,
  search: searchRouter,
  platforms: platformsRouter,
  posts: postsRouter,
  ai: aiRouter,
  apiKeys: apiKeysRouter,
});

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
