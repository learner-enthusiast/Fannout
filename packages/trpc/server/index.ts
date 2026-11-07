import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { usersRouter } from "./routes/users/route";
import { socialConnectionsRouter } from "./routes/social-connections/route";
import { mediaRouter } from "./routes/media/route";
import { notificationsRouter } from "./routes/notifications/route";
import { foldersRouter } from "./routes/folders/route";
import { searchRouter } from "./routes/search/route";

export const serverRouter = router({
  health: healthRouter,
  users: usersRouter,
  socialConnections: socialConnectionsRouter,
  media: mediaRouter,
  notifications: notificationsRouter,
  folders: foldersRouter,
  search: searchRouter,
});

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
