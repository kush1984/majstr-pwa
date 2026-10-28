// The receipt photo the acts short attaches: a FICTIONAL store (no real brand), lines that add up.

import { launch } from './kit.ts';

const ROWS: Array<[string, number, number]> = [
  ['Кабель ВВГнг 3х2,5, м', 100, 24.5],
  ['Підрозетник 68 мм', 30, 9],
  ['Труба гофр. 20 мм, м', 100, 6.2],
  ['Колодка клемна 5-пров.', 20, 7.25],
];

const money = (n: number) => n.toFixed(2).replace('.', ',');

export async function renderReceipt(file: string): Promise<void> {
  const total = ROWS.reduce((s, [, q, p]) => s + q * p, 0);
  const lines = ROWS.map(([n, q, p]) =>
    `<div>${n}</div><div class="l"><span>${q} x ${money(p)}</span><span>${money(q * p)}</span></div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:900px;height:1400px;background:radial-gradient(circle at 30% 20%,#9c7a57,#6e5236);display:grid;place-items:center;font-family:'DejaVu Sans Mono',monospace}
    .r{width:560px;background:#fbfaf6;padding:42px 38px;transform:rotate(-3deg);box-shadow:0 30px 60px rgba(0,0,0,.45);color:#222;font-size:22px;line-height:1.45}
    .c{text-align:center}.b{font-weight:700}.l{display:flex;justify-content:space-between}hr{border:0;border-top:2px dashed #888;margin:14px 0}
  </style></head><body><div class="r">
    <div class="c b" style="font-size:28px">ТОВ «БУДМАРКЕТ ДЕМО»</div><div class="c">м. Львів, вул. Демонстраційна, 1</div><div class="c">ЧЕК № 004127</div><hr>
    ${lines}<hr>
    <div class="l b" style="font-size:30px"><span>СУМА</span><span>${money(total)} грн</span></div><div class="l"><span>Картка</span><span>${money(total)}</span></div><hr>
    <div class="c">${new Date().toLocaleDateString('uk-UA')} 14:37</div><div class="c">ДЯКУЄМО ЗА ПОКУПКУ!</div>
  </div></body></html>`;
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  await page.setContent(html);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
  await browser.close();
}
