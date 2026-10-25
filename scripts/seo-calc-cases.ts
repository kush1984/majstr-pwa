// The typical cases the calculator pages print as a table. The FIGURES are never written here or
// in the HTML: `npm run seo:snapshot` asks the public endpoint for each case and stores the answer
// in src/seo/calc-snapshot.json, the build prints that file, and `npm run seo:check` fails when the
// stored answer and the live one have drifted apart.

export type CalcKind = 'TILE' | 'DRYWALL' | 'PLASTER' | 'SCREED';

export interface CalcCase {
  /** Set when a page also quotes the case in its text, as <!--SEO_EXAMPLE:<id>-->. */
  id?: string;
  /** What the row is called on the page. */
  label: string;
  calculator: CalcKind;
  inputs: Record<string, string | number>;
}

export const CALC_CASES: CalcCase[] = [
  { id: 'bath', label: 'Ванна 2×1,7 м, стіни до стелі (17,1 м²), плитка 300×600', calculator: 'TILE', inputs: { area: 17.1, format: 'T300X600', layout: 'STRAIGHT', wastePercent: 10 } },
  { label: '10 м² плитки 300×300 на підлогу', calculator: 'TILE', inputs: { area: 10, format: 'T300X300', wastePercent: 10 } },
  { label: '10 м² плитки 300×300 по діагоналі', calculator: 'TILE', inputs: { area: 10, format: 'T300X300', layout: 'DIAGONAL', wastePercent: 10 } },
  { label: '6 м² кабанчика на кухонний фартух', calculator: 'TILE', inputs: { area: 6, format: 'METRO', wastePercent: 10 } },
  { label: '20 м² керамограніту 600×600', calculator: 'TILE', inputs: { area: 20, format: 'T600X600', wastePercent: 10 } },
  { label: '35 м² плитки 600×1200 у ванній і на кухні', calculator: 'TILE', inputs: { area: 35, format: 'T600X1200', wastePercent: 10 } },
  { label: '4 м² мозаїки у душовій', calculator: 'TILE', inputs: { area: 4, format: 'MOSAIC', wastePercent: 15 } },
  { label: 'Стеля 18 м², периметр 17 м', calculator: 'DRYWALL', inputs: { area: 18, work: 'CEILING', perimeter: 17, wastePercent: 10 } },
  { label: 'Обшивка стін 30 м²', calculator: 'DRYWALL', inputs: { area: 30, work: 'WALL', wastePercent: 10 } },
  { label: 'Перегородка 12 м², один шар', calculator: 'DRYWALL', inputs: { area: 12, work: 'PARTITION', layers: 1, wastePercent: 10 } },
  { label: 'Перегородка 12 м², два шари', calculator: 'DRYWALL', inputs: { area: 12, work: 'PARTITION', layers: 2, wastePercent: 10 } },
  { id: 'plaster-room', label: 'Кімната 3×4 м, стіни 2,7 м, мінус вікно й двері (34 м²), гіпсова, вручну, 15 мм', calculator: 'PLASTER', inputs: { area: 34, plaster: 'GYPSUM', method: 'MANUAL', thicknessMm: 15, wastePercent: 10 } },
  { label: 'Ванна 18 м² стін, цементно-вапняна, 20 мм', calculator: 'PLASTER', inputs: { area: 18, plaster: 'CEMENT_LIME', thicknessMm: 20, wastePercent: 10 } },
  { label: 'Двокімнатна квартира, 150 м² стін, гіпсова, машиною, 15 мм', calculator: 'PLASTER', inputs: { area: 150, plaster: 'GYPSUM', method: 'MACHINE', thicknessMm: 15, wastePercent: 10 } },
  { label: 'Старий будинок, 40 м² кривих стін, гіпсова, 30 мм', calculator: 'PLASTER', inputs: { area: 40, plaster: 'GYPSUM', method: 'MANUAL', thicknessMm: 30, wastePercent: 10 } },
  { id: 'screed-room', label: 'Кімната 15 м², цементна, 50 мм', calculator: 'SCREED', inputs: { area: 15, screed: 'CEMENT', thicknessMm: 50, wastePercent: 10 } },
  { label: 'Кухня 10 м², цементна, 40 мм', calculator: 'SCREED', inputs: { area: 10, screed: 'CEMENT', thicknessMm: 40, wastePercent: 10 } },
  { label: 'Квартира 55 м², цементна, 60 мм', calculator: 'SCREED', inputs: { area: 55, screed: 'CEMENT', thicknessMm: 60, wastePercent: 10 } },
  { label: 'Наливна підлога 20 м², 5 мм', calculator: 'SCREED', inputs: { area: 20, screed: 'SELF_LEVELLING', thicknessMm: 5, wastePercent: 10 } },
  { label: 'Наливна підлога 12 м², 10 мм', calculator: 'SCREED', inputs: { area: 12, screed: 'SELF_LEVELLING', thicknessMm: 10, wastePercent: 10 } },
];

/** What the snapshot keeps of an answer: enough to print a row, nothing that changes by itself (ids). */
export interface SnapshotMaterial {
  name: string;
  unit: string;
  quantity: number;
  packages: number | null;
  packageName: string | null;
}

export interface SnapshotRow {
  id?: string;
  label: string;
  calculator: CalcKind;
  inputs: Record<string, string | number>;
  materials: SnapshotMaterial[];
}

export interface CalcSnapshot {
  rows: SnapshotRow[];
}

/** The answer's materials reduced to what the page prints — the same reduction on both sides of the check. */
export function reduce(materials: SnapshotMaterial[]): SnapshotMaterial[] {
  return materials.map((m) => ({
    name: m.name,
    unit: m.unit,
    quantity: Number(m.quantity),
    packages: m.packages ?? null,
    packageName: m.packageName ?? null,
  }));
}
