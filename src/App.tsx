import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/routes.tsx';
import { ToastViewport } from '@/components/Toast.tsx';

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ToastViewport />
    </>
  );
}
