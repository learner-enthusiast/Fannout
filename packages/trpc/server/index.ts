import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { usersRouter } from "./routes/users/route";
import { socialConnectionsRouter } from "./routes/social-connections/route";

export const serverRouter = router({
  health: healthRouter,
  users: usersRouter,
  socialConnections: socialConnectionsRouter,
});

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
