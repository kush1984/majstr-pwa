import { Button } from '@/components/Button';
import { useMe } from '@/features/auth/useMe';
import { useLogout } from '@/features/auth/useLogout';
import { EnablePushButton } from './EnablePushButton';

const TRADE_LABEL: Record<string, string> = {
  ELECTRICAL: 'Електрика',
  PLUMBING: 'Сантехніка',
  TILING: 'Плитка',
  GENERAL: 'Загальні роботи',
  OTHER: 'Інше',
};

export function DashboardPage() {
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
              M
            </div>
            <h1 className="text-base font-semibold text-gray-900">Majstr</h1>
          </div>
          <Button variant="ghost" onClick={logout}>Вийти</Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Вітаємо</p>
          <h2 className="mt-1 text-2xl font-semibold text-gray-900">
            {me?.fullName ?? '...'}
          </h2>
          {me && (
            <p className="mt-1 text-sm text-gray-600">
              {TRADE_LABEL[me.trade] ?? me.trade}
              {' · '}
              <span className="text-gray-400">план</span>{' '}
              <span className="font-medium text-brand-700">{me.plan}</span>
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-gray-500">
          Скоро тут будуть ваші об'єкти.
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-sm font-medium text-gray-900">Сповіщення</h3>
          <p className="mb-3 text-xs text-gray-500">
            Отримуйте сповіщення коли клієнт підписує кошторис або залишає коментар.
            На iOS працює лише після встановлення PWA на головний екран.
          </p>
          <EnablePushButton />
        </section>
      </main>
    </div>
  );
}
