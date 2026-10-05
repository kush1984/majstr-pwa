import { describe, it, expect } from 'vitest';
import { parseShares } from './PaymentsBlock.tsx';

/**
 * The shares of a custom payment split, as a master types them (review P-49).
 *
 * <p>The comma used to BE the separator, which is the one thing it cannot be on a Ukrainian
 * keyboard: «33,3, 33,3, 33,4» was cut into six numbers and the sheet previewed a 109 % split. The
 * same shape V145's B-49 found on the calculator's per-position parameter, and the same answer —
 * separate on what is unambiguously a separator and let a comma be a decimal.</p>
 */
describe('parseShares', () => {
  it('reads comma decimals separated by spaces — the shape that used to sum to 109', () => {
    expect(parseShares('33,3 33,3 33,4')).toEqual([33.3, 33.3, 33.4]);
    expect(parseShares('33,3, 33,3, 33,4')).toEqual([33.3, 33.3, 33.4]);
  });

  it('still reads every shape that already worked', () => {
    expect(parseShares('30 40 30')).toEqual([30, 40, 30]);
    expect(parseShares('30,40,30')).toEqual([30, 40, 30]);
    expect(parseShares('30;40;30')).toEqual([30, 40, 30]);
    expect(parseShares('50.5;49.5')).toEqual([50.5, 49.5]);
    expect(parseShares('  30 , 70  ')).toEqual([30, 70]);
  });

  it('drops a share it cannot read rather than counting it as 0 %', () => {
    // 0 % would preview a stage worth nothing and then be refused by the server, which is the
    // wrong place for the master to find out.
    expect(parseShares('30 abc 70')).toEqual([30, 70]);
    expect(parseShares('30 150 70')).toEqual([30, 70]); // over 100 is not a share
    expect(parseShares('')).toEqual([]);
    expect(parseShares('   ')).toEqual([]);
  });

  it('reads one share as one share', () => {
    expect(parseShares('100')).toEqual([100]);
  });
});
