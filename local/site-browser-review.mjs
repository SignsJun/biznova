import { createServer } from 'node:http';
import { renderSite } from './site-generator.mjs';
import { readSiteMedia } from './site-media.mjs';

const viewports = [{ width: 1440, height: 960 }, { width: 390, height: 844 }];
const unavailable = { status: 'unavailable', viewports: [], pages: [], issues: [] };

export async function reviewSiteInBrowser(spec, { signal, capture = false } = {}) {
  const playwright = await import('playwright').catch(() => null);
  if (!playwright || signal?.aborted) return { browser: unavailable, screenshots: [] };
  const pages = spec.pages || [{ slug: '/', sections: [] }];
  const html = new Map(pages.map(page => [page.slug, renderSite(spec, { page: page.slug })]));
  const launch = options => playwright.chromium.launch({ ...options, timeout: 4000 });
  const browser = await launch({}).catch(() => launch({ channel: 'chrome' }).catch(() => null));
  if (!browser) return { browser: unavailable, screenshots: [] };

  const issues = [];
  const checked = [];
  const screenshots = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const asset = url.pathname.match(/^\/assets\/([a-z0-9-]+)\.webp$/);
    const photo = asset && readSiteMedia(asset[1]);
    const document = html.get(url.pathname);
    if (photo) {
      res.writeHead(200, { 'Content-Type': 'image/webp' }).end(photo);
    } else if (document) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'none'; base-uri 'none'",
      }).end(document);
    } else res.writeHead(404).end();
  });
  const stopBrowser = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', stopBrowser, { once: true });

  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const screenshotSlugs = new Set(['/', pages.find(page => page.sections.some(section => section.type === 'catalog'))?.slug]);
    for (const viewport of viewports) {
      if (signal?.aborted) return { browser: unavailable, screenshots: [] };
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(2500);
        const addIssue = (slug, code, message, sectionId) => {
          if (issues.length < 20) issues.push({ severity: 'error', code, message, pageSlug: slug, width: viewport.width, ...(sectionId ? { sectionId } : {}) });
        };
        let currentSlug = '/';
        page.on('pageerror', () => addIssue(currentSlug, 'script-error', 'A page script failed in Chromium.'));
        for (const route of pages) {
          currentSlug = route.slug;
          await page.goto(`${origin}${route.slug}`, { waitUntil: 'load', timeout: 5000 });
          const layout = await page.evaluate(async () => {
            const images = [...document.images];
            for (const image of images) image.loading = 'eager';
            await Promise.all(images.map(image => image.decode().catch(() => {})));
            const width = document.documentElement.clientWidth;
            return {
              broken: images.filter(image => !image.naturalWidth).map(image => image.closest('section')?.id),
              overflow: document.documentElement.scrollWidth > width + 2,
              offenders: [...document.querySelectorAll('main section')].filter(section => section.getBoundingClientRect().right > width + 2 || section.scrollWidth > section.clientWidth + 2).slice(0, 4).map(section => section.id),
            };
          });
          if (layout.overflow) addIssue(route.slug, 'horizontal-overflow', 'The page scrolls horizontally at this viewport.', layout.offenders[0]);
          for (const sectionId of new Set(layout.broken)) addIssue(route.slug, 'broken-image', 'An image could not be loaded.', sectionId);
          if (capture && screenshotSlugs.has(route.slug)) {
            const data = await page.screenshot({ type: 'jpeg', quality: 72, animations: 'disabled', timeout: 5000 });
            screenshots.push({ slug: route.slug, width: viewport.width, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` });
          }
          for (const section of route.sections.filter(section => section.type === 'catalog')) {
            const catalog = page.locator(`#${section.id}`);
            const search = catalog.locator('[data-search]');
            try {
              await search.fill('biznova-no-result-84e1', { timeout: 2000 });
              if (!await catalog.locator('[data-empty]').isVisible()) throw new Error();
              await search.fill('');
              if (new Set(section.items.map(item => item.category)).size > 1) {
                await catalog.locator('[data-category]').selectOption(section.items[0].category);
                const expected = section.items.filter(item => item.category === section.items[0].category).length;
                if (await catalog.locator('[data-product]:visible').count() !== expected) throw new Error();
                await catalog.locator('[data-category]').selectOption('');
              }
              await catalog.locator('[data-product]').first().locator('[data-details]').first().click({ timeout: 2000 });
              const dialog = catalog.getByRole('dialog', { name: 'Product details' });
              if (!await dialog.isVisible()) throw new Error();
              if (section.currency) {
                await dialog.locator('[data-add-detail]').click({ timeout: 2000 });
                await page.reload({ waitUntil: 'load', timeout: 5000 });
                if (await catalog.locator('[data-bag-count]').textContent() !== '1') throw new Error();
                await catalog.locator('[data-open-bag]').click({ timeout: 2000 });
                const bag = catalog.getByRole('dialog', { name: 'Shopping bag' });
                const expected = new Intl.NumberFormat('en', { style: 'currency', currency: section.currency }).format(section.items[0].priceCents / 100);
                if (!await bag.isVisible() || !(await bag.locator('[data-total]').textContent()).includes(expected)) throw new Error();
                await bag.locator('[data-close]').click({ timeout: 2000 });
              } else await dialog.locator('[data-close]').click({ timeout: 2000 });
            } catch {
              if (signal?.aborted) return { browser: unavailable, screenshots: [] };
              addIssue(route.slug, 'catalog-interaction', 'Search, category filtering, product details, or shopping bag persistence failed.', section.id);
              await page.reload({ waitUntil: 'load', timeout: 5000 });
            }
          }
          checked.push({ slug: route.slug, width: viewport.width });
        }
      } finally { await context.close().catch(() => {}); }
    }
    return { browser: { status: issues.length ? 'failed' : 'passed', viewports, pages: checked, issues }, screenshots };
  } catch {
    return { browser: { ...unavailable, pages: checked }, screenshots: [] };
  } finally {
    signal?.removeEventListener('abort', stopBrowser);
    await browser.close().catch(() => {});
    server.closeAllConnections();
    server.close();
  }
}
