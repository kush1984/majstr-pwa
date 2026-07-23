import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { PhotosSection } from './PhotosSection.tsx';
import { downscaleImage } from '@/lib/image.ts';

const uploadMutate = vi.fn();

vi.mock('./usePhotos.ts', () => ({
  usePhotos: () => ({ data: [], isPending: false }),
  useUploadPhoto: () => ({ mutate: uploadMutate, isPending: false }),
  useSetPhotoVisibility: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/plan/usePlanLimits.ts', () => ({
  usePlanLimits: () => ({ data: { maxPhotosPerObject: 10 } }),
  isAtLimit: () => false,
}));
vi.mock('@/lib/image.ts', () => ({ downscaleImage: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('PhotosSection', () => {
  it('offers BOTH a direct-camera input and a gallery input', () => {
    render(<PhotosSection projectId="p1" />);

    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(inputs).toHaveLength(2);
    // Camera path: capture forces the camera app to open right on the object.
    expect(inputs[0].getAttribute('capture')).toBe('environment');
    expect(inputs[0].accept).toBe('image/*');
    // Gallery path: a plain picker, no capture.
    expect(inputs[1].hasAttribute('capture')).toBe(false);
  });

  it('hides the take-photo button on a non-touch device (desktop has no camera flow)', () => {
    // jsdom reports navigator.maxTouchPoints = 0 — the desktop case.
    render(<PhotosSection projectId="p1" />);

    expect(screen.queryByRole('button', { name: /Зробити фото/ })).toBeNull();
    // The single picker drops the «з галереї» framing — it's just "add photos".
    expect(screen.getByRole('button', { name: /Додати фото/ })).toBeTruthy();
  });

  it('accepts a raw camera shot over 10 MB when it downscales under the cap', async () => {
    // A modern phone photo: 14 MB original, a few hundred KB after downscale.
    const big = new File([new Uint8Array(1)], 'shot.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 14 * 1024 * 1024 });
    const small = new File([new Uint8Array(1)], 'shot.jpg', { type: 'image/jpeg' });
    vi.mocked(downscaleImage).mockResolvedValue(small);

    render(<PhotosSection projectId="p1" />);
    const camera = document.querySelector<HTMLInputElement>('input[capture]')!;
    fireEvent.change(camera, { target: { files: [big] } });

    await waitFor(() => expect(uploadMutate).toHaveBeenCalled());
    expect(uploadMutate.mock.calls[0][0]).toEqual({ file: small, source: 'MANUAL' });
  });

  it('rejects a file that is still over the cap after downscaling', async () => {
    const big = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 14 * 1024 * 1024 });
    // Fail-open downscale (old browser) returns the original.
    vi.mocked(downscaleImage).mockResolvedValue(big);

    render(<PhotosSection projectId="p1" />);
    const gallery = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;
    fireEvent.change(gallery, { target: { files: [big] } });

    await waitFor(() => expect(downscaleImage).toHaveBeenCalled());
    expect(uploadMutate).not.toHaveBeenCalled();
  });
});
