import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/lib/i18n.ts';
import { ReceiptPdfSheet } from './ReceiptPdfSheet.tsx';
import type { ProjectPhotoResponse } from '@/api/types.ts';

// Stub the auth-blob thumbnail: click it to toggle selection, like tapping the real tile does.
vi.mock('@/features/photos/PhotoView.tsx', () => ({
  AuthPhoto: ({ alt, onView }: { alt: string; onView: () => void }) => <img alt={alt} onClick={onView} />,
  PhotoLightbox: () => null,
}));

function photo(id: string, source: ProjectPhotoResponse['source'] = 'RECEIPT'): ProjectPhotoResponse {
  return {
    id,
    source,
    visibility: 'PRIVATE',
    caption: null,
    estimateId: source === 'RECEIPT' ? 'e1' : null,
    estimateName: null,
    fileUrl: `/api/projects/p1/photos/${id}/file`,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('ReceiptPdfSheet', () => {
  it('defaults to all receipts selected and confirms with them', () => {
    const onConfirm = vi.fn();
    render(
      <ReceiptPdfSheet receipts={[photo('a'), photo('b')]} otherPhotos={[]} downloading={false} onConfirm={onConfirm} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Завантажити PDF/ }));
    expect(onConfirm).toHaveBeenCalledWith(['a', 'b']);
  });

  it('deselecting a receipt excludes it from the download', () => {
    const onConfirm = vi.fn();
    render(
      <ReceiptPdfSheet receipts={[photo('a'), photo('b')]} otherPhotos={[]} downloading={false} onConfirm={onConfirm} onClose={() => {}} />,
    );

    fireEvent.click(screen.getAllByRole('img')[0]); // toggle 'a' off
    fireEvent.click(screen.getByRole('button', { name: /Завантажити PDF/ }));
    expect(onConfirm).toHaveBeenCalledWith(['b']);
  });

  it('«Зняти всі» downloads a plain PDF with no receipts', () => {
    const onConfirm = vi.fn();
    render(
      <ReceiptPdfSheet receipts={[photo('a'), photo('b')]} otherPhotos={[]} downloading={false} onConfirm={onConfirm} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Зняти всі/ }));
    fireEvent.click(screen.getByRole('button', { name: /без чеків/ }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('object photos start UNchecked and are added only when tapped', () => {
    const onConfirm = vi.fn();
    render(
      <ReceiptPdfSheet
        receipts={[photo('a')]}
        otherPhotos={[photo('m', 'MANUAL')]}
        downloading={false}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    // Default: only the receipt is selected.
    fireEvent.click(screen.getByRole('button', { name: /Завантажити PDF/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(['a']);

    // Tap the manual photo (second img) — now it's included too.
    fireEvent.click(screen.getAllByRole('img')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Завантажити PDF/ }));
    expect(onConfirm).toHaveBeenLastCalledWith(['a', 'm']);
  });
});
