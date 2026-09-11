import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { EstimateNextStep } from './EstimateNextStep.tsx';
import type { EstimateStatus } from '@/api/types.ts';

const onShare = vi.fn();
const onCreateAct = vi.fn();
const onMaterials = vi.fn();
const onPdf = vi.fn();

function setup(status: EstimateStatus, signedAt?: string | null, showMaterials = true) {
  return render(
    <EstimateNextStep
      status={status}
      signedAt={signedAt}
      onShare={onShare}
      onCreateAct={onCreateAct}
      onMaterials={onMaterials}
      showMaterials={showMaterials}
      onPdf={onPdf}
    />,
  );
}

/** The one loud button in the block — the whole design rests on there being exactly one. */
function primary() {
  return screen.getByRole('button', { name: /Надіслати клієнту|Показати посилання|Створити акт/ });
}

describe('EstimateNextStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DRAFT asks whether the estimate is ready and sends it', () => {
    setup('DRAFT');
    expect(screen.getByText('Кошторис готовий?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Надіслати клієнту/ }));
    expect(onShare).toHaveBeenCalled();
  });

  it('SENT waits for the signature and offers the LINK, not a second letter', () => {
    setup('SENT');
    expect(screen.getByText(/Чекаємо підпису/)).toBeTruthy();
    // The reminder was dropped deliberately (there is no reminder flow, and re-sending the same
    // email is not one) — if it ever comes back this assertion is where the decision is recorded.
    expect(screen.queryByRole('button', { name: /Нагадати/ })).toBeFalsy();
    fireEvent.click(screen.getByRole('button', { name: /Показати посилання/ }));
    expect(onShare).toHaveBeenCalled();
  });

  it('SIGNED shows the signing date and leads to the act', () => {
    setup('SIGNED', '2026-09-03T10:15:00Z');
    expect(screen.getByText(/Підписано/)).toBeTruthy();
    expect(screen.getByText(/03\.09\.2026|3 вер/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Створити акт/ }));
    expect(onCreateAct).toHaveBeenCalled();
  });

  it('SIGNED without a date still renders a heading', () => {
    setup('SIGNED', null);
    expect(screen.getByText('Кошторис підписано')).toBeTruthy();
  });

  it('REJECTED renders as DRAFT — the status is unreachable, so it gets no screen of its own', () => {
    setup('REJECTED');
    expect(screen.getByText('Кошторис готовий?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Надіслати клієнту/ })).toBeTruthy();
  });

  it.each<EstimateStatus>(['DRAFT', 'SENT', 'SIGNED', 'REJECTED'])(
    '%s offers exactly one primary action plus the two quiet ones',
    (status) => {
      setup(status);
      expect(primary()).toBeTruthy();
      expect(screen.getByRole('button', { name: /Матеріали до закупівлі/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Зберегти PDF/ })).toBeTruthy();
      // Four buttons total: one primary + materials + PDF is three; a fourth means a second loud
      // action crept in and the block no longer answers its own heading.
      expect(screen.getAllByRole('button')).toHaveLength(3);
    },
  );

  // ~95 % of masters are on a phone, and this block is the last thing they touch on the screen.
  // jsdom computes no layout, so the floor is asserted where it is actually declared — the class.
  it('every action clears the tap-target floor and stretches full width', () => {
    setup('DRAFT');
    const [main, ...rows] = screen.getAllByRole('button');
    expect(main.className).toContain('min-h-[48px]');
    expect(main.className).toContain('w-full');
    rows.forEach((r) => {
      expect(r.className).toContain('min-h-[44px]');
      expect(r.className).toContain('w-full');
    });
  });

  it('drops the materials row entirely when nothing can be calculated (V129)', () => {
    setup('DRAFT', null, false);

    // Absent, not disabled — a greyed row on a trade we have no norms for is the confusion the
    // master asked us to remove, not a smaller version of it.
    expect(screen.queryByRole('button', { name: /Матеріали до закупівлі/ })).toBeFalsy();
    expect(screen.getByRole('button', { name: /Зберегти PDF/ })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('the secondary rows reach the shopping list and the PDF', () => {
    setup('DRAFT');
    fireEvent.click(screen.getByRole('button', { name: /Матеріали до закупівлі/ }));
    expect(onMaterials).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Зберегти PDF/ }));
    expect(onPdf).toHaveBeenCalled();
  });
});
