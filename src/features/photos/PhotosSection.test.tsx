import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/lib/i18n.ts';
import { PhotosSection } from './PhotosSection.tsx';
import { downscaleImage } from '@/lib/image.ts';
import type { ProjectPhotoResponse } from '@/api/types.ts';

const uploadMutate = vi.fn();

// The photo tiles fetch their bytes over an authenticated stream — stub the viewers so the tests
// exercise the grid, not the network.
vi.mock('./PhotoView.tsx', () => ({
  AuthPhoto: ({ alt }: { alt: string }) => <img alt={alt} />,
  PhotoLightbox: () => null,
}));

const holder = vi.hoisted(() => ({
  photos: [] as ProjectPhotoResponse[],
  folders: [] as { id: string; name: string }[],
}));
const createFolderMutate = vi.hoisted(() => vi.fn());
const deleteFolderMutate = vi.hoisted(() => vi.fn());
const setFolderMutate = vi.hoisted(() => vi.fn());
vi.mock('./usePhotos.ts', () => ({
  usePhotos: () => ({ data: holder.photos, isPending: false }),
  useUploadPhoto: () => ({ mutate: uploadMutate, isPending: false }),
  useSetPhotoVisibility: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePhotoFolders: () => ({ data: holder.folders, isPending: false }),
  useCreatePhotoFolder: () => ({ mutate: createFolderMutate, isPending: false }),
  useDeletePhotoFolder: () => ({ mutate: deleteFolderMutate, isPending: false }),
  useSetPhotoFolder: () => ({ mutate: setFolderMutate, isPending: false }),
}));
vi.mock('@/features/plan/usePlanLimits.ts', () => ({
  usePlanLimits: () => ({ data: { maxPhotosPerObject: 10, maxReceiptPhotosPerObject: 10 } }),
  isAtLimit: () => false,
}));
vi.mock('@/lib/image.ts', () => ({ downscaleImage: vi.fn() }));

function photo(over: Partial<ProjectPhotoResponse>): ProjectPhotoResponse {
  return {
    id: 'x',
    source: 'MANUAL',
    visibility: 'PRIVATE',
    caption: null,
    estimateId: null,
    estimateName: null,
    folder: null,
    fileUrl: '/api/projects/p1/photos/x/file',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/** Open a folder from the folder list. */
function openFolder(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  holder.photos = [];
  holder.folders = [];
});

describe('PhotosSection — folders', () => {
  it('opens on the folder list: the two defaults always there, no loose photos beside them', () => {
    holder.photos = [photo({ id: 'm1' }), photo({ id: 'r1', source: 'RECEIPT', folder: 'RECEIPTS' })];
    render(<PhotosSection projectId="p1" />);

    expect(screen.getByText('Чеки')).toBeTruthy();
    expect(screen.getByText('Інше')).toBeTruthy();
    // The whole point of the rework: the list level shows folders, never photo tiles.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    // Counts are per folder, so the master can see where things went without opening each one.
    expect(screen.getAllByText('1 фото')).toHaveLength(2);
  });

  it('a photo moved into a folder is no longer visible in the one it came from', () => {
    // The master's own words: «як у віндовз — якщо туди файл перемістити, то його не видно».
    holder.folders = [{ id: 'f1', name: 'Санвузол' }];
    holder.photos = [photo({ id: 'x1', folder: 'Санвузол', caption: 'плитка' })];
    render(<PhotosSection projectId="p1" />);

    openFolder('Інше');
    expect(screen.queryByText('плитка')).toBeNull();
    expect(screen.getByText(/Папка порожня/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    openFolder('Санвузол');
    expect(screen.getByText('плитка')).toBeTruthy();
  });

  it('«Чеки» holds EVERY receipt of the object, estimate-linked ones included', () => {
    // A folder that quietly hides part of its contents is exactly what the rework is undoing.
    // The second fixture is shaped the way the server really sends it — Jackson `non_null` omits
    // the null keys entirely, and an `estimateId !== null` test on that used to drop the photo.
    holder.photos = [
      photo({ id: 'r1', source: 'RECEIPT', folder: 'RECEIPTS', estimateId: 'e1', estimateName: 'Кухня' }),
      {
        id: 'r2', source: 'RECEIPT', visibility: 'PRIVATE', folder: 'RECEIPTS',
        fileUrl: '/api/projects/p1/photos/r2/file', createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    render(<PhotosSection projectId="p1" />);

    openFolder('Чеки');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/Чек: Кухня/)).toBeTruthy(); // labelled with where it came from
  });

  it('an upload lands in the folder the master is standing in', async () => {
    holder.folders = [{ id: 'f1', name: 'Санвузол' }];
    const file = new File([new Uint8Array(1)], 'shot.jpg', { type: 'image/jpeg' });
    vi.mocked(downscaleImage).mockResolvedValue(file);
    render(<PhotosSection projectId="p1" />);

    openFolder('Санвузол');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!,
      { target: { files: [file] } });

    await waitFor(() => expect(uploadMutate).toHaveBeenCalled());
    expect(uploadMutate.mock.calls[0][0]).toEqual({ file, source: 'MANUAL', folder: 'Санвузол' });
  });

  it('an upload inside «Чеки» is a RECEIPT, inside «Інше» a MANUAL photo with a null folder', async () => {
    const file = new File([new Uint8Array(1)], 'chek.jpg', { type: 'image/jpeg' });
    vi.mocked(downscaleImage).mockResolvedValue(file);
    const { unmount } = render(<PhotosSection projectId="p1" />);

    openFolder('Чеки');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!,
      { target: { files: [file] } });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalled());
    expect(uploadMutate.mock.calls[0][0]).toEqual({ file, source: 'RECEIPT', folder: 'RECEIPTS' });

    unmount();
    uploadMutate.mockClear();
    render(<PhotosSection projectId="p1" />);
    openFolder('Інше');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!,
      { target: { files: [file] } });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalled());
    expect(uploadMutate.mock.calls[0][0]).toEqual({ file, source: 'MANUAL', folder: null });
  });

  it('an empty custom folder survives and is deletable from inside it', () => {
    holder.folders = [{ id: 'f1', name: 'Санвузол' }];
    render(<PhotosSection projectId="p1" />);

    openFolder('Санвузол');
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    expect(deleteFolderMutate).toHaveBeenCalledWith('f1', expect.anything());
  });

  it('a non-empty folder offers no delete — photos reference folders by name', () => {
    holder.folders = [{ id: 'f1', name: 'Санвузол' }];
    holder.photos = [photo({ id: 'x1', folder: 'Санвузол' })];
    render(<PhotosSection projectId="p1" />);

    openFolder('Санвузол');
    // Only the per-tile delete remains, and that one is labelled on the tile itself.
    expect(screen.queryAllByRole('button', { name: 'Видалити' })).toHaveLength(1);
    expect(deleteFolderMutate).not.toHaveBeenCalled();
  });

  it('«Перемістити» moves a photo out with the reserved «Чеки» value', () => {
    holder.photos = [photo({ id: 'x1', caption: 'плитка' })];
    render(<PhotosSection projectId="p1" />);

    openFolder('Інше');
    fireEvent.click(screen.getByText(/Перемістити в папку/));
    fireEvent.click(screen.getByRole('button', { name: 'Чеки' }));
    expect(setFolderMutate).toHaveBeenCalledWith({ photoId: 'x1', folder: 'RECEIPTS' }, expect.anything());
  });
});

describe('PhotosSection — uploading', () => {
  it('offers a direct-camera input and a gallery input inside a folder', () => {
    render(<PhotosSection projectId="p1" />);
    openFolder('Інше');

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
    openFolder('Інше');

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
    openFolder('Інше');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[capture]')!,
      { target: { files: [big] } });

    await waitFor(() => expect(uploadMutate).toHaveBeenCalled());
    expect(uploadMutate.mock.calls[0][0]).toEqual({ file: small, source: 'MANUAL', folder: null });
  });

  it('rejects a file that is still over the cap after downscaling', async () => {
    const big = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 14 * 1024 * 1024 });
    // Fail-open downscale (old browser) returns the original.
    vi.mocked(downscaleImage).mockResolvedValue(big);

    render(<PhotosSection projectId="p1" />);
    openFolder('Інше');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!,
      { target: { files: [big] } });

    await waitFor(() => expect(downscaleImage).toHaveBeenCalled());
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('a receipt tile shows the same "show to client" toggle a progress photo has', () => {
    holder.photos = [photo({ id: 'r1', source: 'RECEIPT', folder: 'RECEIPTS' })];
    render(<PhotosSection projectId="p1" />);

    openFolder('Чеки');
    expect(screen.getByRole('button', { name: /Показати клієнту/ })).toBeTruthy();
  });
});
