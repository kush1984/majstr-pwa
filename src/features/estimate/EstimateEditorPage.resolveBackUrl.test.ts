import { describe, it, expect } from 'vitest';
import { resolveBackUrl } from './EstimateEditorPage.tsx';

describe('resolveBackUrl — «← назад» returns to the tab the master actually came from', () => {
  it('appends ?tab= for a known origin tab (economy)', () => {
    expect(resolveBackUrl('p1', 'economy')).toBe('/projects/p1?tab=economy');
  });

  it('passes a legacy `act` origin straight through — resolveTab maps ?tab=act → economy on arrival', () => {
    expect(resolveBackUrl('p1', 'act')).toBe('/projects/p1?tab=act');
  });

  it('omits the query entirely when there is no origin tab — default Кошторис, unchanged', () => {
    expect(resolveBackUrl('p1', null)).toBe('/projects/p1');
  });

  it('falls back to the projects list when the object id is not known yet', () => {
    expect(resolveBackUrl('', 'economy')).toBe('/projects');
  });
});
