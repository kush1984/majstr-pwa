import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ToastViewport } from './Toast.tsx';
import { Modal } from './Modal.tsx';
import { toast } from '@/hooks/useToast.ts';

let shown: number[] = [];
afterEach(() => {
  shown.forEach((id) => toast.dismiss(id));
  shown = [];
});

function App({ sheet }: { sheet: boolean }) {
  return (
    <>
      <ToastViewport />
      <Modal open={sheet} onClose={() => {}} title="Як вас підписати в документі?">
        <button type="button">Зберегти і продовжити</button>
      </Modal>
    </>
  );
}

describe('ToastViewport — out of a sheet’s way', () => {
  it('sits at the bottom with no sheet open, at the top while one is, and comes back down', () => {
    const { rerender } = render(<App sheet={false} />);
    act(() => { shown.push(toast.success('Прибрано 3 позиції', { ttlMs: 0 })); });
    expect(screen.getByTestId('toast-viewport').dataset.placement).toBe('bottom');
    expect(screen.getByTestId('toast-viewport').className).toContain('bottom-4');

    rerender(<App sheet />);
    expect(screen.getByTestId('toast-viewport').dataset.placement).toBe('top');
    expect(screen.getByTestId('toast-viewport').className).toContain('safe-area-inset-top');
    expect(screen.getByTestId('toast-viewport').className).not.toContain('bottom-4');

    rerender(<App sheet={false} />);
    expect(screen.getByTestId('toast-viewport').dataset.placement).toBe('bottom');
  });
});
