// Captures every manual screenshot in every language: npm run screenshots
// Options: --only=today,shelf  --lang=pt
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { SHOTS } from './shots.mjs';

const ROOT = join(import.meta.dirname, '../..');
const APP = join(ROOT, 'app');
const OUT = join(ROOT, 'docs/manual/img');
const FIXTURES = join(APP, 'e2e/fixtures/practice');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const LANGS = (args.lang ?? 'en,pt,es').split(',');
const ONLY = args.only ? new Set(args.only.split(',')) : null;

const fixtureFiles = [];
const walk = (d) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : fixtureFiles.push(join(d, n))));
walk(FIXTURES);

const server = await createServer({ root: APP, configFile: join(APP, 'vite.config.ts'), server: { port: 1430, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
let failed = 0;

try {
  for (const lang of LANGS) {
    mkdirSync(join(OUT, lang), { recursive: true });
    for (const shot of SHOTS) {
      if (ONLY && !ONLY.has(shot.name)) continue;
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(`${base}?lang=${lang}&theme=light&clock=2026-09-28T09:00&${shot.query}`);
        await page.waitForFunction(() => document.querySelector('#root')?.children.length);
        if (shot.ready) await page.getByTestId(shot.ready).first().waitFor({ timeout: 30000 });
        const loadFixtures = async () => {
          for (const f of fixtureFiles) {
            await page.evaluate(([p, b]) => window.__salaDemo.addFile(p, b), ['/home/demo/import/' + relative(FIXTURES, f), readFileSync(f).toString('base64')]);
          }
        };
        if (shot.steps) await shot.steps(page, lang, { loadFixtures });
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await page.waitForTimeout(400);
        if (errors.length) throw new Error(errors.join('; '));
        await page.screenshot({ path: join(OUT, lang, `${shot.name}.png`) });
        console.log(`✓ ${lang}/${shot.name}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${lang}/${shot.name}: ${e.message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.error(`${failed} screenshot(s) failed.`);
  process.exit(1);
}
