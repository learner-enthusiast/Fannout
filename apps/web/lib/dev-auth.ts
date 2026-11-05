/** Server-only: reads non-public env.
 * Local screenshot/E2E escape hatch: FANNOUT_DEV_AUTH_BYPASS=1 lets the
 * signed-in app render without a Clerk session. Always false in production.
 */
export const devAuthBypass =
    process.env.NODE_ENV !== 'production' &&
    process.env.FANNOUT_DEV_AUTH_BYPASS === '1'
