import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const materials = join(root, 'server/share-materials');
const catalog = JSON.parse(await readFile(join(materials, 'catalog.json'), 'utf8'));
const brand = await readFile(join(root, 'web/favicon.svg'), 'utf8');
const palette = ['#f6ede1', '#edf0e5', '#e8eff1', '#f3e9e7'];
const disciplines = [...new Set(Object.values(catalog).map(card => card.discipline))].sort();
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await mkdir(join(materials, 'covers'), { recursive: true });

const browser = await chromium.launch();
const pending = Object.values(catalog);
try {
  await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await browser.newPage({ viewport: { width: 320, height: 320 }, deviceScaleFactor: 1 });
    try {
      for (let card = pending.pop(); card; card = pending.pop()) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id)) throw new Error('Invalid card ID ' + card.id);
        const paper = palette[disciplines.indexOf(card.discipline) % palette.length];
        await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
          * { box-sizing: border-box; }
          body { margin: 0; background: ${paper}; color: #17372e;
            font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }
          main { display: grid; grid-template-rows: auto 1fr auto; align-items: start; gap: 10px;
            width: 320px; height: 320px; padding: 27px 28px 20px; border-top: 7px solid #176657; }
          .discipline { margin: 0; font-size: 15px; line-height: 1.3; color: #3c6053; }
          .caption { align-self: center; }
          h1 { margin: 0; font-size: 32px; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere;
            text-wrap: balance; }
          .concept { margin: 10px 0 0; font-size: 17px; line-height: 1.3; }
          footer { display: flex; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid #aec0b6;
            font: 600 14px system-ui, sans-serif; }
          footer svg { width: 26px; height: 26px; }
          </style><main>
          <p class="discipline">${escape(card.discipline)}</p>
          <div class="caption"><h1>${escape(card.coverLine)}</h1>
          ${card.coverLine === card.cardTitle ? '' : `<p class="concept">${escape(card.cardTitle)}</p>`}</div>
          <footer>${brand}Concept Discovery</footer></main></html>`);
        const fits = await page.evaluate(() => {
          const caption = document.querySelector('.caption').getBoundingClientRect();
          const footer = document.querySelector('footer').getBoundingClientRect();
          return caption.bottom <= footer.top - 8 && footer.bottom <= 320;
        });
        if (!fits) throw new Error('Share cover text exceeds its bounds: ' + card.id);
        await page.screenshot({ path: join(materials, 'covers', card.id + '.png') });
      }
    } finally {
      await page.close();
    }
  }));
} finally {
  await browser.close();
}
console.log(`Rendered ${Object.keys(catalog).length} share covers.`);
