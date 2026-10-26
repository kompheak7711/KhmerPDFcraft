const { chromium } = require('playwright') /* npm i -D playwright, then: npm run build && npm run preview, node scripts/e2e-smoke.cjs <sample.pdf> <outdir> */;
const path = require('path');
const fs = require('fs');
const here = process.argv[3] || __dirname;
const samplePdf = process.argv[2] || path.join(here, 'sample.pdf');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="font-select"] option').length >= 11, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(here, '01-empty.png') });

  await page.setInputFiles('[data-testid="pdf-input"]', samplePdf);
  await page.waitForSelector('[data-testid="page-0"] canvas');
  await page.waitForTimeout(800);

  // Add first box: Noto Sans Khmer (default)
  const overlay = page.locator('[data-testid="page-0"] .page-overlay');
  await overlay.click({ position: { x: 100, y: 150 } });
  await page.waitForSelector('.text-box.editing');
  await page.keyboard.type('សួស្តី ពិភពលោក');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ខ្មែរ ក្រុង ប្រទេស ភ្នំពេញ');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.text-box.editing', { state: 'detached' });

  // Second box with Battambang, bigger, red (Escape first so the style is a default, not applied to box 1)
  await page.keyboard.press('Escape');
  await page.selectOption('[data-testid="font-select"]', { label: 'Battambang' });
  await page.fill('[data-testid="size-input"]', '36');
  await page.evaluate(() => {
    const i = document.querySelector('input[type=color]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '#a33a2a');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await overlay.click({ position: { x: 100, y: 300 } });
  await page.waitForSelector('.text-box.editing');
  await page.keyboard.type('អក្សរខ្មែរ ដោយ Battambang');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.text-box.editing', { state: 'detached' });

  // Third box with Moul on page 2
  await page.keyboard.press('Escape');
  await page.selectOption('[data-testid="font-select"]', { label: 'Moul' });
  await page.fill('[data-testid="size-input"]', '28');
  const overlay2 = page.locator('[data-testid="page-1"] .page-overlay');
  await overlay2.scrollIntoViewIfNeeded();
  await overlay2.click({ position: { x: 100, y: 200 } });
  await page.waitForSelector('.text-box.editing');
  await page.keyboard.type('ទំព័រទីពីរ');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.text-box.editing', { state: 'detached' });

  // Move the third box by dragging it in select mode
  await page.click('button:has-text("Select")');
  const box3 = page.locator('[data-testid="page-1"] .text-box').first();
  const bb = await box3.boundingBox();
  await page.mouse.move(bb.x + 5, bb.y + 5);
  await page.mouse.down();
  await page.mouse.move(bb.x + 105, bb.y + 55, { steps: 5 });
  await page.mouse.up();

  await page.locator('[data-testid="page-0"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(here, '02-editor.png') });

  const count = await page.locator('.text-box').count();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="download"]')]);
  const out = path.join(here, 'output.pdf');
  await download.saveAs(out);
  const status = await page.locator('[role=status]').innerText();
  console.log('boxes:', count, '| status:', status, '| output bytes:', fs.statSync(out).size);

  // Reopen the exported PDF in the app so pdf.js renders our embedded fonts.
  await page.setInputFiles('[data-testid="pdf-input"]', out);
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="page-0"]').screenshot({ path: path.join(here, '03-reopened-page1.png') });
  await page.locator('[data-testid="page-1"]').screenshot({ path: path.join(here, '04-reopened-page2.png') });

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
