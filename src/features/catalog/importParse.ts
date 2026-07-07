import type { ItemType, Unit } from '@/api/types.ts';

/**
 * Small client mirror of the backend's unit/price/type heuristics — used ONLY to
 * re-derive rows locally when the master reassigns columns on the review screen (no
 * file re-upload). The backend remains the source of truth for the initial parse;
 * every field is still editable per row afterwards.
 */

const UNIT_SYNONYMS: Record<string, Unit> = {
  м2: 'M2', квм: 'M2', 'm2': 'M2', кв: 'M2',
  м3: 'M3', кубм: 'M3', 'm3': 'M3', куб: 'M3',
  мп: 'LINEAR_METER', погм: 'LINEAR_METER', пм: 'LINEAR_METER', рм: 'LINEAR_METER',
  м: 'M', метр: 'M', 'm': 'M',
  шт: 'PIECE', штук: 'PIECE', штука: 'PIECE',
  кг: 'KG', 'kg': 'KG',
  т: 'T', тонн: 'T', тон: 'T',
  год: 'HOUR', ч: 'HOUR', час: 'HOUR',
  компл: 'SET', комплект: 'SET', кт: 'SET', набір: 'SET',
  точка: 'POINT', точок: 'POINT',
  '%': 'PERCENT', процент: 'PERCENT',
};

const MATERIAL_MARKERS = [
  'клей', 'суміш', 'мішок', 'грунтовк', 'ґрунтовк', 'фарб', 'шпакл', 'кабель', 'провід',
  'труб', 'профіл', 'плитк', 'цемент', 'пісок', 'саморіз', 'дюбел', 'герметик', 'матеріал',
];

export function guessUnit(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  const token = raw
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/[.\s'"]/g, '');
  return UNIT_SYNONYMS[token] ?? null;
}

export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/грн|₴|uah|руб/g, '').replace(/\s/g, '').trim();
  if (!s || /[a-zа-яіїєґ]/i.test(s)) return null; // has letters → text, not a price
  let cleaned = s.replace(/[^0-9.,-]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    cleaned = cleaned.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    cleaned = cleaned.replace(',', '.');
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return Math.round(n * 100) / 100;
}

export function guessType(name: string): ItemType {
  const n = name.toLowerCase();
  return MATERIAL_MARKERS.some((m) => n.includes(m)) ? 'MATERIAL' : 'WORK';
}
