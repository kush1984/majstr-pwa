import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/routes.tsx';
import { ToastViewport } from '@/components/Toast.tsx';
import { OfflineBanner } from '@/components/OfflineBanner.tsx';
import { UpdateBanner } from '@/components/UpdateBanner.tsx';
import { SenderSheetHost } from '@/features/sender/SenderSheetHost.tsx';

export function App() {
  return (
    <>
      <OfflineBanner />
      <RouterProvider router={router} />
      <SenderSheetHost />
      <UpdateBanner />
      <ToastViewport />
    </>
  );
}
