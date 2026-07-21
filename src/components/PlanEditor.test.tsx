import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { PlanEditor } from './PlanEditor.tsx';

describe('PlanEditor', () => {
  it('renders the room, the bus entry marker and one dot per point', () => {
    render(
      <PlanEditor
        widthMm={4000}
        lengthMm={3000}
        bus={[{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }]}
        points={[{ x: 0.2, y: 0.9 }, { x: 0.8, y: 0.9 }]}
        pointKinds={['socket', 'switch']}
        onBusChange={vi.fn()}
        onPointsChange={vi.fn()}
      />,
    );

    // The first bus vertex is labelled as the entry (щиток / panel).
    expect(screen.getByText(/щиток|panel/i)).toBeTruthy();
    // A numbered dot per point.
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });
});
