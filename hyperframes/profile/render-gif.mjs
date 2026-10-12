// Renders index.html to ../../assets/header.gif by seeking the GSAP timeline
// frame by frame in a headless browser. GitHub READMEs cannot play MP4 inline,
// so the header ships as a GIF.
//
//   npm install --no-save puppeteer-core gifenc pngjs
//   node render-gif.mjs
//
// BROWSER_PATH overrides the browser (any Chromium build works).

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'assets', 'header.gif');
const COMPOSITION = 'profile';
const FPS = 15;

const browserPath =
  process.env.BROWSER_PATH ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(existsSync);
if (!browserPath) throw new Error('No Chromium browser found. Set BROWSER_PATH.');

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(join(HERE, 'index.html')).href, { waitUntil: 'networkidle0' });

const { width, height, duration } = await page.evaluate(() => {
  const root = document.querySelector('[data-composition-id]');
  return {
    width: Number(root.dataset.width),
    height: Number(root.dataset.height),
    duration: Number(root.dataset.duration),
  };
});
await page.setViewport({ width, height, deviceScaleFactor: 1 });

const frames = [];
const total = Math.round(duration * FPS);
for (let i = 0; i <= total; i++) {
  await page.evaluate((id, t) => void window.__timelines[id].time(t), COMPOSITION, i / FPS);
  frames.push(PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' }))).data);
}
await browser.close();

// One palette for the whole film, so unchanged pixels can be skipped per frame.
const step = Math.max(1, Math.floor(frames.length / 12));
const sample = Buffer.concat(frames.filter((_, i) => i % step === 0 || i === frames.length - 1));
const palette = quantize(sample, 255);
const TRANSPARENT = palette.length;
palette.push([0, 0, 0]);

const gif = GIFEncoder();
const frameDelay = Math.round(1000 / FPS);
let previous = null;
let pending = null;

const flush = () => {
  if (!pending) return;
  gif.writeFrame(pending.index, width, height, {
    palette,
    delay: pending.delay,
    transparent: pending.transparent,
    transparentIndex: TRANSPARENT,
    dispose: 1,
  });
};

for (const rgba of frames) {
  const index = applyPalette(rgba, palette);
  if (!previous) {
    pending = { index, delay: frameDelay, transparent: false };
    previous = index;
    continue;
  }
  const delta = new Uint8Array(index.length);
  let changed = 0;
  for (let p = 0; p < index.length; p++) {
    if (index[p] === previous[p]) delta[p] = TRANSPARENT;
    else {
      delta[p] = index[p];
      changed++;
    }
  }
  if (changed === 0) {
    pending.delay += frameDelay;
    continue;
  }
  flush();
  pending = { index: delta, delay: frameDelay, transparent: true };
  previous = index;
}
flush();
gif.finish();

await writeFile(OUT, gif.bytes());
console.log(`Wrote ${OUT} (${frames.length} frames captured, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
