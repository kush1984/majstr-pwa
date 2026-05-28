import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/routes';
import { ToastViewport } from '@/components/Toast';

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ToastViewport />
    </>
  );
}
