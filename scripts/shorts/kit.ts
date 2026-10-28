/// <reference lib="dom" />
// What every short shares: the phone the scenario plays on, the recording, and the composition into
// a 1080 × 1920 short (a hook, a caption per step, the phone in a bezel, an outro card, music).
// The scenarios live beside it: scripts/short-video.ts (estimate → signature) and
// scripts/short-economy.ts (signed estimate → economy → «Мої гроші»).
//
//   SHORT_PACE=1.5       stretches every pause (1 = brisk)
//   SHORT_REALTIME=1     keeps the recording's own speed instead of fitting it to ~31 s
//   SHORT_MUSIC=…m4a     lays the track under the short, crossfaded into itself when it runs out
//   SHORT_SHOTS=1        drops a PNG at every step into <out>/debug/
//   PW_CHROMIUM=…        a Chromium to launch instead of Playwright's own

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SHOTS = process.env.SHORT_SHOTS === '1';
/** SHORT_PACE stretches every pause (1 = brisk, 1.5 = easy to follow on a phone). */
export const PACE = Number(process.env.SHORT_PACE ?? 1);
const REALTIME = process.env.SHORT_REALTIME === '1';

/** A human pace: the viewer has to see the tap land before the screen moves on. */
export const beat = (page: Page, ms = 700) => page.waitForTimeout(ms * PACE);

export async function typeSlow(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).click();
  await page.locator(selector).pressSequentially(text, { delay: 35 * PACE });
}

export function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

const probeSeconds = (file: string) =>
  Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());

export async function startVite(port: number, apiBase: string): Promise<ChildProcess> {
  const app = `http://localhost:${port}`;
  const vite = spawn(`npx vite --port ${port} --strictPort`, {
    cwd: root, env: { ...process.env, VITE_API_BASE_URL: apiBase }, shell: true, stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(app)).ok) return vite;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  vite.kill();
  throw new Error(`Vite did not start on ${app}`);
}

export function launch(): Promise<Browser> {
  return chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
}

/** A phone: 390 × 844 at 2×, Ukrainian, no service worker, nothing reaching past `allow`. */
export async function phoneContext(browser: Browser, allow: RegExp): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
    serviceWorkers: 'block',
  });
  // Nothing leaves the machine: fonts fall back to the system face, analytics never loads.
  await context.route((url) => !allow.test(url.href), (r) => r.abort());
  return context;
}

/** When each caption starts, in seconds of the raw recording. */
export interface Step { label: string; at: number }

/**
 * The recording is a run of full-resolution screenshots (780 × 1688), taken back to back while the
 * scenario plays — Playwright's video recorder writes a 2× page into the top-left quarter of a grey
 * frame instead of scaling it, and Chrome's screencast hands over CSS-pixel frames (390 wide). Each
 * shot is stamped with its time and held until the next, so the clip runs in real time.
 */
export class Recorder {
  readonly steps: Step[] = [];
  private t0 = 0;
  private shot = 0;
  private stopLoop: (() => Promise<void>) | null = null;

  constructor(readonly outDir: string) {
    rmSync(path.join(outDir, 'raw'), { recursive: true, force: true });
    mkdirSync(path.join(outDir, 'raw'), { recursive: true });
    if (SHOTS) {
      rmSync(path.join(outDir, 'debug'), { recursive: true, force: true });
      mkdirSync(path.join(outDir, 'debug'), { recursive: true });
    }
  }

  start(page: Page): void {
    const dir = path.join(this.outDir, 'raw');
    const frames: Array<{ file: string; t: number }> = [];
    let running = true;
    this.t0 = Date.now();
    const loop = (async () => {
      while (running) {
        const t = Date.now() / 1000;
        try {
          const jpg = await page.screenshot({ type: 'jpeg', quality: 90, caret: 'initial', timeout: 2000 });
          const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
          writeFileSync(file, jpg);
          frames.push({ file, t });
        } catch {
          // mid-navigation: no frame this time, the last one holds
        }
      }
    })();
    this.stopLoop = async () => {
      running = false;
      await loop;
      const end = Date.now() / 1000;
      // The concat list starts at t0, so a step's time is a time in the clip.
      const lines: string[] = [];
      frames.forEach((fr, i) => {
        const from = i === 0 ? this.t0 / 1000 : fr.t;
        const to = i + 1 < frames.length ? frames[i + 1].t : end;
        lines.push(`file '${fr.file}'`, `duration ${Math.max(0.001, to - from).toFixed(4)}`);
      });
      lines.push(`file '${frames[frames.length - 1].file}'`);
      writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n'));
      ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'), '-vf', 'scale=780:1688,fps=30,format=yuv420p',
        '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', path.join(dir, 'raw.mp4')]);
      const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 1;
      console.log(`  recorded ${frames.length} frames, ${(frames.length / span).toFixed(1)} fps`);
    };
  }

  async stop(): Promise<void> {
    await this.stopLoop?.();
  }

  async step(page: Page, label: string): Promise<void> {
    this.steps.push({ label, at: (Date.now() - this.t0) / 1000 });
    console.log(`  ▸ ${label}`);
    await this.snap(page, label);
  }

  async snap(page: Page, name: string): Promise<void> {
    if (!SHOTS) return;
    const file = `${String(++this.shot).padStart(2, '0')}-${name.replace(/[^\p{L}\d]+/gu, '_')}.png`;
    await page.screenshot({ path: path.join(this.outDir, 'debug', file) });
  }

  /** The payoff, kept as a still: the hook opens on it. */
  async still(page: Page): Promise<void> {
    await page.screenshot({ path: path.join(this.outDir, 'still.png') });
  }
}

// ---- composing the short -------------------------------------------------------------------------

const W = 1080;
const H = 1920;
/** Where the phone sits in the frame: the 780 × 1688 recording scaled to fit. */
const PHONE = { x: 220, y: 440, w: 640, h: 1385, r: 46 };
const PAPER = '#f7f1e7';
const INK = '#2b1d14';
const AMBER = '#f26b1f';
const FONT = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";

const HOOK_SECONDS = 2.4;
const OUTRO_SECONDS = 3.2;
/** The body is sped up to land the whole short near the music's length. */
const TARGET_SECONDS = 31;

export interface ShortSpec {
  /** Over every step: what the short is about. */
  title: string;
  hook: {
    /** Two lines; the second is drawn in the brand colour. */
    lines: [string, string];
    chip: string;
    /** A stamp over the still («✓ Підписано»), or none. */
    badge?: string;
  };
  /** Under «Majstr» on the outro card. */
  outroLine: string;
  /** The file name under the output directory. */
  file: string;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frameHtml(inner: string, transparent = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:${FONT};color:${INK}}
    body{background:${transparent ? 'transparent' : `${PAPER} linear-gradient(rgba(43,29,20,.045) 1px,transparent 1px) 0 0/48px 48px, linear-gradient(90deg,rgba(43,29,20,.045) 1px,transparent 1px) 0 0/48px 48px`}}
    .brand{position:absolute;top:58px;left:0;right:0;text-align:center;font-weight:800;font-size:34px;color:${AMBER}}
    .brand span{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:${AMBER};color:#fff;margin-right:10px;vertical-align:middle}
    .title{position:absolute;top:128px;left:40px;right:40px;text-align:center;font-weight:800;font-size:60px;line-height:1.08;letter-spacing:-.02em}
    .sub{position:absolute;top:268px;left:0;right:0;text-align:center;font-size:26px;color:#7a6652}
    .chip{position:absolute;top:330px;left:0;right:0;text-align:center}
    .chip b{display:inline-block;background:${INK};color:#fff;font-size:38px;font-weight:700;padding:16px 30px;border-radius:999px;max-width:960px}
    .foot{position:absolute;bottom:34px;left:0;right:0;text-align:center;font-size:28px;font-weight:700;color:#7a6652}
  </style></head><body>${inner}</body></html>`;
}

const header = (title: string, caption: string) => `
  <div class="brand"><span>M</span>Majstr</div>
  <div class="title">${esc(title)}</div>
  <div class="sub">реальний запис${REALTIME ? '' : ' · прискорено'}</div>
  <div class="chip"><b>${esc(caption)}</b></div>`;

/** The phone's frame: a dark ring, and the corners outside it painted paper — over the recording. */
function bezelHtml(): string {
  const { x, y, w, h, r } = PHONE;
  const round = `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return frameHtml(`<svg width="${W}" height="${H}" style="position:absolute;inset:0">
    <path fill-rule="evenodd" fill="${PAPER}" d="M${x - 2},${y - 2} H${x + w + 2} V${y + h + 2} H${x - 2} Z ${round}"/>
    <path d="${round}" fill="none" stroke="${INK}" stroke-width="12"/>
  </svg>`, true);
}

function hookHtml(spec: ShortSpec, stillPng: string): string {
  const { x, y, w, h, r } = PHONE;
  const badge = spec.hook.badge
    ? `<div style="position:absolute;left:${x + w - 230}px;top:${y + 380}px;transform:rotate(-8deg);background:#1f9d55;color:#fff;font-weight:800;font-size:46px;padding:16px 30px;border-radius:18px;box-shadow:0 12px 30px rgba(0,0,0,.25)">${esc(spec.hook.badge)}</div>`
    : '';
  return frameHtml(`
    <div class="brand"><span>M</span>Majstr</div>
    <div class="title" style="font-size:66px;top:120px">${esc(spec.hook.lines[0])}<br><span style="color:${AMBER}">${esc(spec.hook.lines[1])}</span></div>
    <div class="chip" style="top:340px"><b>${esc(spec.hook.chip)}</b></div>
    <img src="${stillPng}" style="position:absolute;left:${x}px;top:${y + 10}px;width:${w}px;height:${h}px;object-fit:cover;object-position:top;border-radius:${r}px;outline:12px solid ${INK}">
    ${badge}
    <div class="foot">majstr.pro</div>`);
}

function outroHtml(spec: ShortSpec): string {
  return frameHtml(`
    <div style="position:absolute;top:560px;left:0;right:0;text-align:center">
      <div style="display:inline-grid;place-items:center;width:200px;height:200px;border-radius:48px;background:${AMBER};color:#fff;font-size:130px;font-weight:800">M</div>
      <div style="font-size:110px;font-weight:800;margin-top:36px;letter-spacing:-.03em">Majstr</div>
      <div style="font-size:40px;color:#7a6652;margin-top:8px">${esc(spec.outroLine)}</div>
      <div style="display:inline-block;margin-top:70px;background:${AMBER};color:#fff;font-size:52px;font-weight:800;padding:28px 56px;border-radius:24px">Спробуй безкоштовно</div>
      <div style="font-size:64px;font-weight:800;margin-top:50px">majstr.pro</div>
      <div style="font-size:34px;color:#7a6652;margin-top:14px">2 обʼєкти безкоштовно · без картки</div>
    </div>`);
}

async function renderPng(browser: Browser, html: string, file: string, transparent = false): Promise<void> {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

export async function compose(browser: Browser, rec: Recorder, spec: ShortSpec): Promise<void> {
  const { outDir, steps } = rec;
  const rawPath = path.join(outDir, 'raw', 'raw.mp4');
  const frames = path.join(outDir, 'frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const still = `data:image/png;base64,${readFileSync(path.join(outDir, 'still.png')).toString('base64')}`;
  await renderPng(browser, hookHtml(spec, still), path.join(frames, 'hook.png'));
  await renderPng(browser, outroHtml(spec), path.join(frames, 'outro.png'));
  await renderPng(browser, bezelHtml(), path.join(frames, 'bezel.png'), true);
  for (const [i, st] of steps.entries()) {
    await renderPng(browser, frameHtml(`${header(spec.title, st.label)}<div class="foot">majstr.pro</div>`), path.join(frames, `bg-${i}.png`));
  }

  const duration = probeSeconds(rawPath);
  const bodyRaw = duration - steps[0].at;
  const speed = REALTIME ? 1 : Math.max(1, bodyRaw / (TARGET_SECONDS - HOOK_SECONDS - OUTRO_SECONDS));
  console.log(`  raw ${bodyRaw.toFixed(1)} s of steps → ×${speed.toFixed(2)}`);

  // One input per step background, then the bezel, hook and outro stills.
  const inputs = ['-i', rawPath];
  steps.forEach((_, i) => inputs.push('-loop', '1', '-i', path.join(frames, `bg-${i}.png`)));
  const bezel = steps.length + 1;
  inputs.push('-loop', '1', '-i', path.join(frames, 'bezel.png'));
  inputs.push('-loop', '1', '-t', String(HOOK_SECONDS), '-i', path.join(frames, 'hook.png'));
  inputs.push('-loop', '1', '-t', String(OUTRO_SECONDS), '-i', path.join(frames, 'outro.png'));
  const hook = bezel + 1;
  const outro = bezel + 2;

  const f: string[] = [];
  f.push(`[0:v]fps=30,scale=${PHONE.w}:${PHONE.h}:flags=lanczos,split=${steps.length}${steps.map((_, i) => `[v${i}]`).join('')}`);
  f.push(`[${bezel}:v]format=rgba,split=${steps.length}${steps.map((_, i) => `[z${i}]`).join('')}`);
  steps.forEach((st, i) => {
    const end = i + 1 < steps.length ? steps[i + 1].at : duration;
    const len = (end - st.at) / speed;
    f.push(`[v${i}]trim=start=${st.at.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)}[c${i}]`);
    f.push(`[${i + 1}:v]fps=30,trim=duration=${len.toFixed(3)}[b${i}]`);
    f.push(`[b${i}][c${i}]overlay=${PHONE.x}:${PHONE.y}:shortest=1[o${i}]`);
    f.push(`[o${i}][z${i}]overlay=0:0:shortest=1,setsar=1[s${i}]`);
  });
  f.push(`[${hook}:v]fps=30,setsar=1[h]`);
  f.push(`[${outro}:v]fps=30,setsar=1[e]`);
  f.push(`[h]${steps.map((_, i) => `[s${i}]`).join('')}[e]concat=n=${steps.length + 2}:v=1:a=0,format=yuv420p[out]`);
  const silent = path.join(outDir, 'silent.mp4');
  ffmpeg([...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30', silent]);

  const music = process.env.SHORT_MUSIC;
  const final = path.join(outDir, spec.file);
  if (!music) {
    renameSync(silent, final);
    console.log('  (no SHORT_MUSIC — the short is silent)');
  } else {
    const len = probeSeconds(silent);
    // A short longer than the track gets the track again, crossfaded over its own fade-out.
    ffmpeg(['-i', silent, '-i', music, '-i', music, '-i', music, '-filter_complex',
      `[1:a][2:a]acrossfade=d=2[m1];[m1][3:a]acrossfade=d=2[m];[m]atrim=duration=${len.toFixed(3)},afade=t=out:st=${(len - 1.5).toFixed(3)}:d=1.5[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', final]);
    rmSync(silent);
  }
  writeFileSync(path.join(outDir, 'steps.json'), JSON.stringify(steps, null, 2));
  console.log(`  ✓ ${path.relative(root, final)}`);
}
