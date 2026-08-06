import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n.ts';
import { EstimateReceipts } from './EstimateReceipts.tsx';
import type { ProjectPhotoResponse } from '@/api/types.ts';

// The photo tiles fetch their bytes over an authenticated stream — stub the viewers so the test
// exercises the filtering/rendering, not the network.
vi.mock('@/features/photos/PhotoView.tsx', () => ({
  AuthPhoto: ({ alt }: { alt: string }) => <img alt={alt} />,
  PhotoLightbox: () => null,
}));

const holder = vi.hoisted(() => ({ photos: [] as ProjectPhotoResponse[] }));
vi.mock('@/features/photos/usePhotos.ts', () => ({
  usePhotos: () => ({ data: holder.photos, isPending: false }),
  useDeletePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function receipt(id: string, estimateId: string | null): ProjectPhotoResponse {
  return {
    id,
    source: 'RECEIPT',
    visibility: 'PRIVATE',
    caption: null,
    estimateId,
    estimateName: null,
    fileUrl: `/api/projects/p1/photos/${id}/file`,
    createdAt: '2026-01-01T00:00:00Z',
  };
}
function manual(id: string): ProjectPhotoResponse {
  return { ...receipt(id, null), source: 'MANUAL' };
}

beforeEach(() => {
  holder.photos = [];
});

describe('EstimateReceipts', () => {
  it('shows only the receipts linked to THIS estimate', () => {
    holder.photos = [
      receipt('r1', 'e1'), // this estimate
      receipt('r2', 'e1'), // this estimate
      receipt('r3', 'e2'), // another estimate — excluded
      manual('m1'), // progress photo — excluded
    ];

    render(<EstimateReceipts projectId="p1" estimateId="e1" signed={false} />);

    expect(screen.getByText(/Чеки/)).toBeTruthy();
    // Two tiles (r1, r2), not the other-estimate receipt or the manual photo.
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('also shows receipts of source estimates (consolidated)', () => {
    holder.photos = [
      receipt('r1', 'e1'), // this consolidated estimate
      receipt('r2', 'src-a'), // a source estimate — included via sourceEstimateIds
      receipt('r3', 'e2'), // unrelated estimate — excluded
    ];

    render(
      <EstimateReceipts projectId="p1" estimateId="e1" sourceEstimateIds={['src-a']} signed={false} />,
    );

    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('renders nothing when the estimate has no receipts', () => {
    holder.photos = [receipt('r3', 'e2'), manual('m1')];

    const { container } = render(<EstimateReceipts projectId="p1" estimateId="e1" signed={false} />);

    expect(container.firstChild).toBeNull();
  });

  it('hides the delete control on a signed (read-only) estimate', () => {
    holder.photos = [receipt('r1', 'e1')];

    render(<EstimateReceipts projectId="p1" estimateId="e1" signed />);

    expect(screen.getByText(/Чеки/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Видалити/ })).toBeNull();
  });
});
