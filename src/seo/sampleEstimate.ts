// The sample estimate on /zrazok-koshtorysu. Every position and price is the library's own — the
// TILING bundle «Ванна кімната — стіни і підлога» and each position's suggested_price at backend
// V179 — so the page shows what a master really gets from the template. Only the quantities are the
// example's: a bathroom of about 2 × 1,7 m, walls 17 m², floor 3,4 m². Totals are computed, never typed.

export type SampleUnit = 'M2' | 'LINEAR_METER' | 'PIECE' | 'M3';

export interface SampleLine {
  section: string;
  name: string;
  unit: SampleUnit;
  quantity: number;
  /** ₴ per unit, whole hryvnias as the library ships them. */
  price: number;
}

export const SAMPLE_WALLS_M2 = 17;
export const SAMPLE_FLOOR_M2 = 3.4;
const TILED = SAMPLE_WALLS_M2 + SAMPLE_FLOOR_M2;

export const SAMPLE_LINES: SampleLine[] = [
  { section: 'Підготовка та захист', name: 'Захист підлоги картоном', unit: 'M2', quantity: 6, price: 30 },
  { section: 'Підготовчі роботи', name: 'Демонтаж плитки', unit: 'M2', quantity: TILED, price: 224 },
  { section: 'Підготовчі роботи', name: 'Очищення, обезпилювання', unit: 'M2', quantity: TILED, price: 41 },
  { section: 'Підготовчі роботи', name: 'Ґрунтування поверхні', unit: 'M2', quantity: TILED, price: 35 },
  { section: 'Підготовчі роботи', name: 'Вирівнювання поверхні шаром клею', unit: 'M2', quantity: 6, price: 209 },
  { section: 'Підготовчі роботи', name: 'Нанесення гідроізоляційної мастики у 2 шари', unit: 'M2', quantity: 6.4, price: 174 },
  { section: 'Підготовчі роботи', name: 'Армування кутів гідроізоляційної стрічкою', unit: 'LINEAR_METER', quantity: 9, price: 119 },
  { section: 'Підготовчі роботи', name: 'Поклейка гідроізоляційних муфт на водорозетки', unit: 'PIECE', quantity: 4, price: 250 },
  { section: 'Укладання плитки', name: 'Укладання плитки 300х600', unit: 'M2', quantity: SAMPLE_WALLS_M2, price: 850 },
  { section: 'Укладання плитки', name: 'Укладання плитки 300х300', unit: 'M2', quantity: SAMPLE_FLOOR_M2, price: 800 },
  { section: 'Оброблення плитки та вироби', name: 'Виріз отворів до 70 мм', unit: 'PIECE', quantity: 6, price: 240 },
  { section: 'Оброблення плитки та вироби', name: 'Встановлення профілю для плитки', unit: 'LINEAR_METER', quantity: 6, price: 230 },
  { section: 'Затирання швів', name: 'Заповнення швів цементною сумішшю', unit: 'M2', quantity: TILED, price: 170 },
  { section: 'Затирання швів', name: 'Заповнення швів герметиком', unit: 'LINEAR_METER', quantity: 8, price: 220 },
  { section: 'Організаційні послуги', name: 'Миття плитки від цементного нальоту після затирання', unit: 'M2', quantity: TILED, price: 40 },
  { section: 'Організаційні послуги', name: 'Фасування сміття в мішки', unit: 'PIECE', quantity: 20, price: 15 },
  { section: 'Організаційні послуги', name: 'Винесення та вивезення будівельного сміття', unit: 'M3', quantity: 1, price: 600 },
  { section: 'Організаційні послуги', name: 'Прибирання приміщення після робіт', unit: 'M2', quantity: 4, price: 40 },
];

/** In kopecks, so a sum of lines never drifts by a floating-point kopeck. */
export function lineTotalKop(line: SampleLine): number {
  return Math.round(line.quantity * line.price * 100);
}

export interface SampleSection {
  name: string;
  lines: SampleLine[];
}

/** Sections in first-appearance order — the order the bundle files them in, like the app's PDF. */
export function sampleSections(lines: SampleLine[] = SAMPLE_LINES): SampleSection[] {
  const sections: SampleSection[] = [];
  for (const line of lines) {
    const last = sections.find((s) => s.name === line.section);
    if (last) last.lines.push(line);
    else sections.push({ name: line.section, lines: [line] });
  }
  return sections;
}

export function sampleTotalKop(lines: SampleLine[] = SAMPLE_LINES): number {
  return lines.reduce((sum, line) => sum + lineTotalKop(line), 0);
}
