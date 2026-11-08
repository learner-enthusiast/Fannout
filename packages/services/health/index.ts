import { logger } from "@repo/logger";

/** An external dependency and a cheap check that throws when it is unreachable. */
export type Dependency = { name: string; check: () => Promise<void> };

export type DependencyStatus = {
  name: string;
  healthy: boolean;
  latencyMs: number;
  /** Underlying cause when unhealthy (no URLs or credentials). */
  error?: string;
};

export type WaitOptions = {
  attempts?: number;
  attemptTimeoutMs?: number;
  baseDelayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Drizzle wraps driver errors as "Failed query: …"; surface the real cause (e.g. ECONNREFUSED). */
export function describeError(error: unknown): string {
  let current = error;
  const parts: string[] = [];
  while (current instanceof Error && parts.length < 4) {
    const code = (current as { code?: string }).code;
    // Skip drizzle's "Failed query: <sql> params: …" wrapper: it leaks params and hides the cause.
    if (!(current.message.startsWith("Failed query:") && current.cause)) {
      parts.push(code ? `${current.message} [${code}]` : current.message || current.name);
    }
    if (current instanceof AggregateError) {
      parts.push(...current.errors.map(describeError));
      break;
    }
    current = current.cause;
  }
  return parts.join(" <- ") || String(error);
}

/** Run every check once, in parallel, and report each result. Never throws. */
export async function probeDependencies(
  dependencies: Dependency[],
  timeoutMs = 2_000,
): Promise<DependencyStatus[]> {
  return Promise.all(
    dependencies.map(async ({ name, check }) => {
      const start = Date.now();
      try {
        await withTimeout(check(), timeoutMs);
        return { name, healthy: true, latencyMs: Date.now() - start };
      } catch (error) {
        return { name, healthy: false, latencyMs: Date.now() - start, error: describeError(error) };
      }
    }),
  );
}

async function waitForOne(
  { name, check }: Dependency,
  { attempts, attemptTimeoutMs, baseDelayMs }: Required<WaitOptions>,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await withTimeout(check(), attemptTimeoutMs);
      logger.info(`Connected to ${name}`);
      return;
    } catch (error) {
      const reason = describeError(error);
      if (attempt >= attempts) throw new Error(`${name}: ${reason}`);
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`${name} not ready (attempt ${attempt}/${attempts}), retrying in ${delay}ms`, { reason });
      await sleep(delay);
    }
  }
}

/**
 * Block until every dependency answers. Retries each with exponential backoff
 * (so `docker compose up` racing the process is fine) and throws listing every
 * dependency that never came up. Call before accepting traffic or jobs.
 */
export async function waitForDependencies(
  dependencies: Dependency[],
  options: WaitOptions = {},
): Promise<void> {
  const resolved = { attempts: 5, attemptTimeoutMs: 5_000, baseDelayMs: 1_000, ...options };
  const results = await Promise.allSettled(dependencies.map((d) => waitForOne(d, resolved)));
  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  if (failures.length) {
    throw new Error(`Startup dependency check failed:\n  - ${failures.join("\n  - ")}`);
  }
}
