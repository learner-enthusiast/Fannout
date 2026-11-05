import { getAuth } from "@clerk/express";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export async function createContext({ req }: CreateExpressContextOptions) {
  const { userId } = getAuth(req);
  return { userId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
