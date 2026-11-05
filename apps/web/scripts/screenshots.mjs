// Playwright screenshots of the UI foundation.
// Usage: (dev server on :3000 with FANNOUT_DEV_AUTH_BYPASS=1)
//   NODE_PATH=$(npm root -g) node scripts/screenshots.mjs [baseUrl]
// Output: apps/web/screenshots/<route>-<theme>-<width>-<sidebar>.png
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const base = process.argv[2] ?? 'http://localhost:3000'
const outDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'screenshots'
)
mkdirSync(outDir, { recursive: true })

const routes = ['/', '/dashboard', '/connections', '/theme-preview']
const themes = ['dark', 'light']
const widths = [375, 1280]
const sidebars = ['expanded', 'collapsed']

const browser = await chromium.launch({ headless: true })
const problems = []
for (const theme of themes) {
    for (const width of widths) {
        for (const sidebar of sidebars) {
            const context = await browser.newContext({
                viewport: { width, height: 900 },
                reducedMotion: 'reduce',
            })
            await context.addCookies([
                {
                    name: 'sidebar_state',
                    value: String(sidebar === 'expanded'),
                    url: base,
                },
                // Signed-out Clerk dev-browser state, so no handshake redirect
                // happens when running with placeholder keys.
                { name: '__client_uat', value: '0', url: base },
                { name: '__clerk_db_jwt', value: 'dvb_local', url: base },
            ])
            await context.addInitScript((t) => {
                localStorage.setItem('fannout-theme', t)
            }, theme)
            const page = await context.newPage()
            page.on('pageerror', (e) =>
                problems.push(`${page.url()}: ${e.message}`)
            )
            for (const route of routes) {
                // "/" has no sidebar — only shoot it once per theme/width
                if (route === '/' && sidebar === 'collapsed') continue
                await page.goto(base + route, { waitUntil: 'load' })
                await page.waitForTimeout(800)
                const overflow = await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth > window.innerWidth
                )
                if (overflow)
                    problems.push(
                        `horizontal overflow: ${route} ${theme} ${width}`
                    )
                const name = `${route === '/' ? 'home' : route.slice(1)}-${theme}-${width}${route === '/' ? '' : `-${sidebar}`}.png`
                await page.screenshot({
                    path: join(outDir, name),
                    fullPage: true,
                })
            }
            await context.close()
        }
    }
}
await browser.close()
console.log(problems.length ? problems.join('\n') : 'no page errors / overflow')
