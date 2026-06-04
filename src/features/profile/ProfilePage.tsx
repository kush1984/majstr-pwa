import { useQuery } from '@tanstack/react-query';
import { useMe } from '@/features/auth/useMe.ts';
import { useLogout } from '@/features/auth/useLogout.ts';
import { usePush } from '@/hooks/usePush.ts';
import { isIOS, isStandalone } from '@/lib/push.ts';
import { toast } from '@/hooks/useToast.ts';
import { projectsApi } from '@/api/projects.ts';
import { initials } from '@/lib/format.ts';
import { TRADE_EMOJI, TRADE_LABEL } from '@/lib/labels.ts';
import type { Plan } from '@/api/types.ts';

/** Object limits per plan (UI display; the backend enforces them). FREE = 3. */
const PROJECT_LIMIT: Record<Plan, number | null> = {
  FREE: 3,
  PRO: null,
  TEAM: null,
};

export function ProfilePage() {
  const { data: me } = useMe();
  const logout = useLogout();

  // Used object count for the limit bar — the real list, not a guess.
  const projects = useQuery({
    queryKey: ['projects', 'list', 'all'],
    queryFn: () => projectsApi.list(),
  });

  const plan = me?.plan ?? 'FREE';
  const limit = PROJECT_LIMIT[plan];
  const used = projects.data?.length ?? 0;
  const isPro = plan !== 'FREE';

  return (
    <>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
        Профіль
      </h1>

      {/* Hero */}
      <div className="mb-4 rounded-card bg-gradient-to-br from-brand-soft to-brand-soft-2 p-5 text-center">
        <div className="mx-auto mb-3 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-brand text-3xl font-bold text-white shadow-cta">
          {initials(me?.fullName) || '—'}
        </div>
        <div className="text-lg font-bold text-primary">{me?.fullName ?? '...'}</div>
        {me && me.trades.length > 0 && (
          <div className="mt-1.5 inline-block rounded-full bg-surface px-3 py-1 text-xs font-semibold text-secondary">
            {me.trades.map((t) => `${TRADE_EMOJI[t]} ${TRADE_LABEL[t]}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Plan card */}
      <div className="mb-4 rounded-card bg-ink p-4 text-white">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <div className="text-[13px] text-white/65">Поточний план</div>
            <div className="text-lg font-extrabold">{plan}</div>
          </div>
          <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold uppercase">
            {plan === 'FREE' ? 'Безкоштовно' : 'Активний'}
          </span>
        </div>

        <div className="my-3 rounded-xl bg-white/[0.08] p-3">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-white/70">Об'єкти</span>
            <span className="font-semibold">
              {limit === null ? 'Без обмежень' : `${used} з ${limit}`}
            </span>
          </div>
          {limit !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-[width]"
                style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }}
              />
            </div>
          )}
        </div>

        {!isPro && (
          <button
            type="button"
            onClick={() => toast.info('Оплата підписки буде доступна найближчим часом')}
            className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white"
          >
            ⭐ Оновити до PRO · 199 ₴/міс
          </button>
        )}
      </div>

      {/* Menu */}
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <LogoRow isPro={isPro} />
        <PushRow />
        <MenuRow
          icon="⚙️"
          title="Налаштування"
          sub="Профіль, контакти"
          onClick={() => toast.info('Налаштування профілю — скоро')}
        />
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-3 p-3.5 text-left"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-danger-soft text-base text-danger">
            ↪
          </span>
          <span className="text-sm font-medium text-danger">Вийти</span>
        </button>
      </div>

      {limit !== null && used >= limit && (
        <p className="mt-3 text-center text-xs text-muted">
          Досягнуто ліміту об'єктів. Оновіть план, щоб створювати більше.
        </p>
      )}
    </>
  );
}

function MenuRow({
  icon,
  title,
  sub,
  onClick,
  locked = false,
}: {
  icon: string;
  title: string;
  sub?: string;
  onClick?: () => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border p-3.5 text-left last:border-b-0"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{title}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      {locked ? (
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">
          PRO
        </span>
      ) : (
        <span className="text-base text-faint">›</span>
      )}
    </button>
  );
}

function LogoRow({ isPro }: { isPro: boolean }) {
  return (
    <MenuRow
      icon="🖼️"
      title="Логотип компанії"
      sub={isPro ? 'Для брендованих PDF' : 'Доступно в PRO'}
      locked={!isPro}
      onClick={
        isPro
          ? () => toast.info('Завантаження логотипу — скоро')
          : () => toast.info('Брендований PDF доступний у плані PRO')
      }
    />
  );
}

/**
 * Push notifications row with an on/off toggle. Permission is requested only
 * when the user flips the switch (never on load). On iPhone/iPad web push only
 * works once the PWA is installed to the home screen, so we surface that as a
 * hint instead of a dead toggle.
 */
function PushRow() {
  const { permission, isSubscribed, isReady, isBusy, enable, disable } = usePush();
  if (!isReady) return null;

  // iOS Safari only exposes PushManager inside an installed PWA. If we're an
  // un-installed iOS tab, explain how to enable it rather than show "unsupported".
  const iosNeedsInstall = permission === 'unsupported' && isIOS() && !isStandalone();

  const toggle = async () => {
    if (isBusy) return;
    if (isSubscribed) {
      await disable();
      toast.info('Сповіщення вимкнено');
      return;
    }
    const r = await enable();
    if (r.ok) toast.success('Сповіщення увімкнено');
    else if (r.error) toast.error(r.error);
  };

  const sub = iosNeedsInstall
    ? 'Додайте застосунок на головний екран, щоб увімкнути'
    : permission === 'unsupported'
      ? 'Недоступно у цьому браузері'
      : permission === 'denied'
        ? 'Заблоковано в налаштуваннях браузера'
        : isSubscribed
          ? 'Увімкнено на цьому пристрої'
          : 'Сповіщення про підпис і питання клієнта';

  const canToggle =
    permission !== 'unsupported' && permission !== 'denied' && !iosNeedsInstall;

  return (
    <div className="flex w-full items-center gap-3 border-b border-border p-3.5 last:border-b-0">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
        🔔
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">Сповіщення</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      {canToggle ? (
        <button
          type="button"
          role="switch"
          aria-checked={isSubscribed}
          aria-label="Push-сповіщення"
          disabled={isBusy}
          onClick={toggle}
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            isSubscribed ? 'bg-brand' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              isSubscribed ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      ) : (
        <span className="text-base text-faint">🔕</span>
      )}
    </div>
  );
}
