// «Сума прописом» — a mirror of the backend's HryvniaInWords (the act PDF), so the sample act page
// spells a sum exactly as a real act does. Mirrored pair: change both; hryvniaInWords.test.ts carries
// the backend test's cases verbatim.

const ONES_MASC = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES_FEM = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const TEENS = [
  'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять',
  "п'ятнадцять", 'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять",
];
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];

type Forms = readonly [string, string, string];
const HRYVNIA: Forms = ['гривня', 'гривні', 'гривень'];
const KOPECK: Forms = ['копійка', 'копійки', 'копійок'];
const THOUSAND: Forms = ['тисяча', 'тисячі', 'тисяч'];
const MILLION: Forms = ['мільйон', 'мільйони', 'мільйонів'];
const MILLIARD: Forms = ['мільярд', 'мільярди', 'мільярдів'];

function pick(n: number, forms: Forms): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

function triplet(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const t = Math.floor(rem / 10);
  const u = rem % 10;
  if (h > 0) words.push(HUNDREDS[h]);
  if (t === 1) {
    words.push(TEENS[u]);
  } else {
    if (t > 1) words.push(TENS[t]);
    if (u > 0) words.push((feminine ? ONES_FEM : ONES_MASC)[u]);
  }
  return words;
}

function integerWords(n: number): string {
  if (n === 0) return 'нуль';
  const words: string[] = [];
  const group = (value: number, feminine: boolean, noun: Forms) => {
    if (value === 0) return;
    words.push(...triplet(value, feminine), pick(value, noun));
  };
  group(Math.floor(n / 1_000_000_000) % 1000, false, MILLIARD);
  group(Math.floor(n / 1_000_000) % 1000, false, MILLION);
  group(Math.floor(n / 1000) % 1000, true, THOUSAND);
  words.push(...triplet(n % 1000, true));
  return words.join(' ');
}

/** 150005 kopecks → «Одна тисяча п'ятсот гривень 05 копійок». */
export function hryvniaInWords(kopecks: number): string {
  const hryvnias = Math.floor(kopecks / 100);
  const kop = kopecks % 100;
  const text = `${integerWords(hryvnias)} ${pick(hryvnias, HRYVNIA)} ${String(kop).padStart(2, '0')} ${pick(kop, KOPECK)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
