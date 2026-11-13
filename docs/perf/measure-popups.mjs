import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire("/home/arnab-smnta/.nvm/versions/node/v24.10.0/lib/node_modules/")("playwright");
const D = process.argv[2], BASE = process.argv[3] ?? "http://localhost:3100", OUT = process.argv[4] ?? `${D}/results.json`;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ storageState: `${D}/auth.json`, viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: e.startTime, d: e.duration }))).observe({ entryTypes: ["longtask"] }); } catch {}
  window.__measure = (sel, timeout = 4000) => new Promise((res) => {
    const t0 = performance.now(), lt0 = window.__lt.length;
    let mounted = null;
    const tick = () => {
      const el = document.querySelector(sel);
      const now = performance.now();
      if (el) {
        const r = el.getBoundingClientRect();
        if (mounted == null && r.width > 0 && r.height > 0) mounted = now - t0;
        if (mounted != null && parseFloat(getComputedStyle(el).opacity) >= 0.98) {
          return setTimeout(() => res({ mountedMs: Math.round(mounted), visibleMs: Math.round(now - t0), longTasks: window.__lt.slice(lt0).filter((x) => x.s >= t0).map((x) => Math.round(x.d)) }), 150);
        }
      }
      if (now - t0 > timeout) return res({ mountedMs: mounted && Math.round(mounted), visibleMs: null, longTasks: [], timeout: true });
      requestAnimationFrame(tick);
    };
    tick();
  });
});
const p = await ctx.newPage();
const hydr = [];
p.on("console", (m) => /hydrat|did not match|Warning:/i.test(m.text()) && hydr.push(m.text().slice(0, 200)));
const POPUP = '[data-slot="popover-content"],[data-slot="dialog-content"],[data-slot="dropdown-menu-content"],[data-slot="alert-dialog-content"],[data-slot="sheet-content"],[data-slot="select-content"],[data-slot="command"]';
const cases = [
  ["/dashboard", "Notification bell", 'button[aria-label^="Notifications"]', '[data-slot="popover-content"]'],
  ["/dashboard", "User menu", 'button[aria-label="Open user menu"]', '[role="dialog"]'],
  ["/media", "Type filter", 'button:has-text("Type")', POPUP],
  ["/media", "Orientation filter", 'button:has-text("Orientation")', POPUP],
  ["/media", "Upload", 'button:has-text("Upload")', POPUP],
  ["/media", "Search (header)", 'button[aria-label="Search folders and media"]', '[data-slot="command"],[data-slot="dialog-content"],[data-slot="popover-content"]'],
];
const RUNS = 5, results = [];
for (const [path, name, trig, content] of cases) {
  await p.goto(`${BASE}${path}`, { waitUntil: "load" }); await p.waitForTimeout(2500);
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const loc = p.locator(trig).first();
    if (!(await loc.count())) { runs.push({ missing: true }); break; }
    await loc.hover().catch(() => {});
    await p.evaluate(([s]) => { window.__pending = window.__measure(s); }, [content]);
    await loc.click({ timeout: 3000 }).catch(() => {});
    runs.push(await p.evaluate(() => window.__pending));
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    if (p.url().includes("/folders/new")) { await p.goBack(); await p.waitForTimeout(800); }
  }
  const ok = runs.filter((r) => r.visibleMs != null);
  const med = (k) => ok.length ? [...ok.map((r) => r[k])].sort((a, c) => a - c)[Math.floor(ok.length / 2)] : null;
  results.push({ name, path, runs: runs.length, missing: runs[0]?.missing ?? false, timeouts: runs.filter((r) => r.timeout).length, mountedMs: med("mountedMs"), visibleMs: med("visibleMs"), maxLongTask: Math.max(0, ...runs.flatMap((r) => r.longTasks ?? [])), longTaskCount: runs.flatMap((r) => r.longTasks ?? []).length });
  console.log(JSON.stringify(results.at(-1)));
}
console.log("hydration/console warnings:", [...new Set(hydr)]);
fs.writeFileSync(OUT, JSON.stringify({ results, hydr }, null, 1));
await b.close();
