import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/routes.tsx';
import { ToastViewport } from '@/components/Toast.tsx';
import { OfflineBanner } from '@/components/OfflineBanner.tsx';

export function App() {
  return (
    <>
      <OfflineBanner />
      <RouterProvider router={router} />
      <ToastViewport />
    </>
  );
}
