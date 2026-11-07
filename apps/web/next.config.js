import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Load the monorepo root .env. Done here (not via `node --env-file`) because
// Next forks workers that copy Node flags into NODE_OPTIONS, which rejects
// --env-file. Existing process.env values are never overridden.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/** Express API that the web app proxies to (server-side only). */
const apiUrl = (process.env.BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const webHost = process.env.WEB_URL ? new URL(process.env.WEB_URL).hostname : undefined

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Keep the dev badge from covering the sidebar footer / screenshots.
    devIndicators: false,

    // Allow dev assets/HMR when the app is opened through a tunnel (ngrok).
    allowedDevOrigins: webHost && webHost !== 'localhost' ? [webHost] : [],

    /**
     * Same-origin proxy to the API. OAuth connect + callback must share one
     * host so the browser-binding cookie round-trips; with this, the whole app
     * (web, /trpc, /api/oauth, webhooks) can sit behind a single ngrok URL.
     * The OAuth logic itself still runs in the Express API.
     */
    async rewrites() {
        return [
            { source: '/trpc/:path*', destination: `${apiUrl}/trpc/:path*` },
            { source: '/api/oauth/:path*', destination: `${apiUrl}/api/oauth/:path*` },
            { source: '/webhooks/:path*', destination: `${apiUrl}/webhooks/:path*` },
        ]
    },
}

export default nextConfig
