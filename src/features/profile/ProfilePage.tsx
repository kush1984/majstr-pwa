import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useMe, ME_QUERY_KEY } from '@/features/auth/useMe.ts';
import { profileApi } from '@/api/profile.ts';
import { billingApi } from '@/api/billing.ts';
import { useLogout } from '@/features/auth/useLogout.ts';
import { useSyncStatus } from '@/lib/useOnline.ts';
import { upgradeApi } from '@/api/upgrade.ts';
import { UpgradeIntentModal } from '@/features/upgrade/UpgradeIntentModal.tsx';
import { EmailVerifyModal } from '@/features/email/EmailVerifyModal.tsx';
import { Modal } from '@/components/Modal.tsx';
import { Button } from '@/components/Button.tsx';
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { useDeleteLogo, useUploadLogo } from './useProfile.ts';
import { usePush } from '@/hooks/usePush.ts';
import { isIOS, isStandalone } from '@/lib/push.ts';
import { toast } from '@/hooks/useToast.ts';
import { toAppError } from '@/api/errors.ts';
import { projectsApi } from '@/api/projects.ts';
import { Spinner } from '@/components/Spinner.tsx';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';
import { initials } from '@/lib/format.ts';
import { TRADE_EMOJI } from '@/lib/labels.ts';
import { config } from '@/lib/config.ts';
import type { Plan, UserResponse } from '@/api/types.ts';

/** Mirrors the backend cap (spring.servlet.multipart.max-file-size: 2MB) so we
 *  reject oversized files with a friendly message before the upload leaves. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg'];

/** Object limits per plan (UI display; the backend enforces them). FREE = 2. */
const PROJECT_LIMIT: Record<Plan, number | null> = {
  FREE: 2,
  PRO: null,
  TEAM: null,
};

export function ProfilePage() {
  // TODO(i18n): language switcher + hotkey — G2
  const { t } = useTranslation();
  const { data: me } = useMe();
  const logout = useLogout();
  const { pending: pendingSync } = useSyncStatus();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const [proVerifyOpen, setProVerifyOpen] = useState(false);

  // Used object count for the limit bar — the real list, not a guess.
  const projects = useQuery({
    queryKey: ['projects', 'list', 'all'],
    queryFn: () => projectsApi.list(),
  });

  const plan = me?.plan ?? 'FREE';
  const limit = PROJECT_LIMIT[plan];
  const used = projects.data?.length ?? 0;
  const isPro = plan !== 'FREE';

  // Trial offer is visible to any FREE master who hasn't used it. Activation still
  // requires a verified email (anti-abuse) — but the button stays visible and an
  // unverified click explains the verify step (with a "pay now instead" option).
  const canStartTrial = plan === 'FREE' && !me?.trialStartedAt;

  // Any PRO path (trial OR paid) requires a verified email. Unverified → the
  // verify reminder; verified → the real action.
  const onTrialClick = () => {
    if (me?.emailVerified) void startTrial();
    else setProVerifyOpen(true);
  };

  const onUpgradeClick = () => {
    void upgradeApi.click('PROFILE');
    if (me?.emailVerified) setUpgradeOpen(true);
    else setProVerifyOpen(true);
  };

  const qc = useQueryClient();
  const startTrial = async () => {
    try {
      const updated = await billingApi.startTrial();
      qc.setQueryData(ME_QUERY_KEY, updated);
      toast.success(
        t('billing.trialStarted', {
          date: updated.planExpiresAt
            ? new Date(updated.planExpiresAt).toLocaleDateString('uk-UA')
            : '',
        }),
      );
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const toggleAutoRenew = async (enabled: boolean) => {
    try {
      const updated = await profileApi.setAutoRenew(enabled);
      qc.setQueryData(ME_QUERY_KEY, updated);
      toast.success(
        enabled
          ? t('billing.autoRenewOn')
          : t('billing.autoRenewOff', {
              date: updated.planExpiresAt
                ? new Date(updated.planExpiresAt).toLocaleDateString('uk-UA')
                : '',
            }),
      );
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-primary sm:text-[26px]">
        {t('profile.title')}
      </h1>

      {/* Hero */}
      <div className="mb-4 rounded-card bg-gradient-to-br from-brand-soft to-brand-soft-2 p-5 text-center">
        <div className="mx-auto mb-3 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-brand text-3xl font-bold text-white shadow-cta">
          {initials(me?.fullName) || '—'}
        </div>
        <div className="text-lg font-bold text-primary">{me?.fullName ?? '...'}</div>
        {me && me.trades.length > 0 && (
          <div className="mt-1.5 inline-block rounded-full bg-surface px-3 py-1 text-xs font-semibold text-secondary">
            {me.trades.map((trade) => `${TRADE_EMOJI[trade]} ${t('trades.' + trade)}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Plan card */}
      <div className="mb-4 rounded-card bg-ink p-4 text-white">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <div className="text-[13px] text-white/65">{t('profile.currentPlan')}</div>
            <div className="text-lg font-extrabold">{plan}</div>
            {isPro && me?.planExpiresAt && (
              <div className="text-[11px] text-white/65">
                {t('profile.planActiveUntil', {
                  date: new Date(me.planExpiresAt).toLocaleDateString('uk-UA'),
                })}
              </div>
            )}
          </div>
          <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold uppercase">
            {plan === 'FREE' ? t('profile.planFree') : t('profile.planActive')}
          </span>
        </div>

        <div className="my-3 rounded-xl bg-white/[0.08] p-3">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="text-white/70">{t('profile.objects')}</span>
            <span className="font-semibold">
              {limit === null ? t('profile.unlimited') : t('profile.usedOfLimit', { used, limit })}
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

        {isPro && (
          <div className="mb-3 rounded-xl bg-white/[0.08] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t('billing.autoRenew')}</span>
              <span className="font-semibold">
                {me?.autoRenew ? t('billing.on') : t('billing.off')}
                {me?.cardMask ? ` · ${me.cardMask}` : ''}
              </span>
            </div>
            {me?.autoRenew ? (
              <button
                type="button"
                onClick={() => toggleAutoRenew(false)}
                className="mt-2 text-white/70 underline"
              >
                {t('billing.disableAutoRenew')}
              </button>
            ) : me?.cardMask ? (
              <button
                type="button"
                onClick={() => toggleAutoRenew(true)}
                className="mt-2 font-semibold text-brand"
              >
                {t('billing.enableAutoRenew')}
              </button>
            ) : (
              // No saved card (upgraded without opting in) — enabling needs to
              // tokenize a card, which monobank only does during a payment. Route
              // through checkout (auto-renew pre-checked); the copy is honest that
              // it charges for the next period and saves the card.
              <>
                <button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  className="mt-2 font-semibold text-brand"
                >
                  {t('billing.enableAutoRenew')}
                </button>
                <p className="mt-1 text-white/50">{t('billing.enableAutoRenewNoCardHint')}</p>
              </>
            )}
          </div>
        )}

        {!isPro && (
          <button
            type="button"
            onClick={onUpgradeClick}
            className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white"
          >
            {t('profile.upgradeToPro')}
          </button>
        )}

        {canStartTrial && (
          <button
            type="button"
            onClick={onTrialClick}
            className="mt-2 w-full rounded-xl border border-brand py-2.5 text-sm font-bold text-brand"
          >
            {t('billing.tryTrial')}
          </button>
        )}
      </div>

      {me && <ReferralCard code={me.referralCode} />}

      <UpgradeIntentModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <EmailVerifyModal open={emailGateOpen} onClose={() => setEmailGateOpen(false)} />
      <ProfileEditModal open={editOpen} onClose={() => setEditOpen(false)} />

      {/* Unverified master tapped a PRO CTA (trial or upgrade): no PRO without a
          verified email, so route them to verification — no pay-now bypass. */}
      <Modal
        open={proVerifyOpen}
        onClose={() => setProVerifyOpen(false)}
        title={t('billing.proVerifyTitle')}
      >
        <p className="mb-5 text-sm text-muted">{t('billing.proVerifyMessage')}</p>
        <Button
          fullWidth
          onClick={() => {
            setProVerifyOpen(false);
            setEmailGateOpen(true);
          }}
        >
          {t('billing.verifyEmailCta')}
        </Button>
      </Modal>

      {/* Menu */}
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <MenuRow
          icon="✏️"
          title={t('profile.editProfile')}
          sub={t('profile.editProfileSub')}
          onClick={() => setEditOpen(true)}
        />
        <LogoRow me={me} />
        <PushRow />
        <MenuRow
          icon="⚙️"
          title={t('profile.settings')}
          sub={t('profile.settingsSub')}
          onClick={() => toast.info(t('profile.settingsSoon'))}
        />
        <button
          type="button"
          onClick={() => setLogoutConfirmOpen(true)}
          className="flex w-full items-center gap-3 p-3.5 text-left"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-danger-soft text-base text-danger">
            ↪
          </span>
          <span className="text-sm font-medium text-danger">{t('profile.logout')}</span>
        </button>
        <ConfirmDialog
          open={logoutConfirmOpen}
          title={t('profile.logout')}
          // Logout wipes the device's local copy — including any UNSYNCED offline changes. Warn
          // clearly (with the count) when there are pending writes, so a master doesn't lose work.
          message={pendingSync > 0
            ? t('profile.logoutUnsyncedConfirm', { n: pendingSync })
            : t('profile.logoutConfirm')}
          confirmLabel={t('profile.logout')}
          onConfirm={() => {
            setLogoutConfirmOpen(false);
            logout();
          }}
          onClose={() => setLogoutConfirmOpen(false)}
        />
      </div>

      {/* Help / support contacts (#17) — values come from config (env-overridable) */}
      <h2 className="mb-2 mt-5 text-[13px] font-bold uppercase tracking-wide text-muted">
        {t('profile.help')}
      </h2>
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <ContactRow
          icon="✉️"
          title={t('profile.supportEmail')}
          sub={config.supportEmail}
          href={`mailto:${config.supportEmail}`}
        />
        <ContactRow
          icon="📞"
          title={t('profile.supportPhone')}
          sub={config.supportPhone}
          href={`tel:${config.supportPhone.replace(/[^+\d]/g, '')}`}
        />
        <div className="flex w-full items-center gap-3 p-3.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
            ℹ️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-primary">
              {t('profile.appVersion')}
            </span>
          </span>
          <span className="text-xs text-muted">{__APP_VERSION__}</span>
        </div>
      </div>

      {limit !== null && used >= limit && (
        <p className="mt-3 text-center text-xs text-muted">
          {t('profile.limitReached')}
        </p>
      )}
    </>
  );
}

/**
 * "Запроси майстра" — the master's personal invite link + a three-number summary
 * (invited / paid / months earned). Sharing uses the native Share sheet on mobile
 * and falls back to clipboard on desktop.
 */
function ReferralCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const link = `${window.location.origin}/?ref=m-${code}`;
  const stats = useQuery({
    queryKey: ['referrals', 'me'],
    queryFn: () => billingApi.referralStats(),
  });

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: t('referral.shareText'), url: link });
      } else {
        await navigator.clipboard.writeText(link);
        toast.success(t('referral.copied'));
      }
    } catch {
      // User dismissed the native share sheet — not an error.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('referral.copied'));
    } catch {
      toast.error(t('referral.copyFailed'));
    }
  };

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-bold text-primary">{t('referral.title')}</h2>
      <p className="mt-1 text-xs text-secondary">{t('referral.explainer')}</p>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-sunken px-3 py-2 text-xs text-secondary">
          {link}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex-shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary"
        >
          {t('referral.copy')}
        </button>
      </div>

      <button
        type="button"
        onClick={share}
        className="mt-2 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-white"
      >
        {t('referral.share')}
      </button>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <ReferralStat label={t('referral.invited')} value={stats.data?.invited ?? 0} />
        <ReferralStat label={t('referral.paid')} value={stats.data?.paid ?? 0} />
        <ReferralStat label={t('referral.monthsEarned')} value={stats.data?.monthsEarned ?? 0} />
      </div>
    </div>
  );
}

function ReferralStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-sunken p-2.5">
      <div className="text-lg font-extrabold text-primary">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted">{label}</div>
    </div>
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

/** Anchor variant of MenuRow for mailto:/tel: links — same look, real <a>. */
function ContactRow({
  icon,
  title,
  sub,
  href,
}: {
  icon: string;
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex w-full items-center gap-3 border-b border-border p-3.5 text-left last:border-b-0"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      <span className="text-base text-faint">›</span>
    </a>
  );
}

/**
 * Company logo: upload / replace / delete. Available on every plan — the logo
 * brands the client portal for all contractors; it additionally appears on the
 * PDF for PRO (the BRANDED_PDF feature), surfaced as a hint for FREE users.
 * The file is validated client-side (PNG/JPEG, ≤2 MB to match the backend cap)
 * before upload, with a spinner while in flight and friendly toasts on
 * success / failure. `logoUrl` from `/me` is a relative `/api/files/...` path,
 * so we prefix the API base for the <img> preview.
 */
function LogoRow({ me }: { me: UserResponse | undefined }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadLogo();
  const remove = useDeleteLogo();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const logoSrc = me?.logoUrl ? `${config.apiBaseUrl}${me.logoUrl}` : null;
  const isFree = (me?.plan ?? 'FREE') === 'FREE';
  const busy = upload.isPending || remove.isPending;

  const pick = () => fileRef.current?.click();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the user re-pick the same file after an error
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error(t('profile.logoInvalidType'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('profile.logoTooLarge'));
      return;
    }
    try {
      await upload.mutateAsync(file);
      toast.success(t('profile.logoUploaded'));
    } catch (err) {
      toast.error(toAppError(err).message);
    }
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync();
      toast.success(t('profile.logoDeleted'));
    } catch (err) {
      toast.error(toAppError(err).message);
    } finally {
      setConfirmOpen(false);
    }
  };

  const sub =
    (logoSrc ? t('profile.logoInPortal') : t('profile.logoHint')) +
    (isFree ? ` · ${t('profile.logoFreePdfNote')}` : '');

  return (
    <div className="flex w-full items-center gap-3 border-b border-border p-3.5 last:border-b-0">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={onFile}
      />
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={t('profile.companyLogo')}
          className="h-9 w-9 flex-shrink-0 rounded-[10px] border border-border bg-white object-contain"
        />
      ) : (
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
          🖼️
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{t('profile.companyLogo')}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>

      {busy ? (
        <Spinner size="sm" className="text-brand" />
      ) : logoSrc ? (
        <span className="flex flex-shrink-0 items-center gap-3">
          <button type="button" onClick={pick} className="text-xs font-semibold text-brand">
            {t('profile.logoReplace')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="text-xs font-semibold text-danger"
          >
            {t('common.delete')}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex-shrink-0 text-xs font-semibold text-brand"
        >
          {t('profile.logoUpload')}
        </button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('profile.logoDeleteTitle')}
        message={t('profile.logoDeleteMessage')}
        loading={remove.isPending}
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/**
 * Push notifications row with an on/off toggle. Permission is requested only
 * when the user flips the switch (never on load). On iPhone/iPad web push only
 * works once the PWA is installed to the home screen, so we surface that as a
 * hint instead of a dead toggle.
 */
function PushRow() {
  const { t } = useTranslation();
  const { permission, isSubscribed, isReady, isBusy, enable, disable } = usePush();
  if (!isReady) return null;

  // iOS Safari only exposes PushManager inside an installed PWA. If we're an
  // un-installed iOS tab, explain how to enable it rather than show "unsupported".
  const iosNeedsInstall = permission === 'unsupported' && isIOS() && !isStandalone();

  const toggle = async () => {
    if (isBusy) return;
    if (isSubscribed) {
      await disable();
      toast.info(t('profile.notificationsOff'));
      return;
    }
    const r = await enable();
    if (r.ok) toast.success(t('profile.notificationsOn'));
    else if (r.error) toast.error(r.error);
  };

  const sub = iosNeedsInstall
    ? t('profile.pushAddToHome')
    : permission === 'unsupported'
      ? t('profile.pushUnsupported')
      : permission === 'denied'
        ? t('profile.pushDenied')
        : isSubscribed
          ? t('profile.pushEnabledOnDevice')
          : t('profile.pushDescription');

  const canToggle =
    permission !== 'unsupported' && permission !== 'denied' && !iosNeedsInstall;

  return (
    <div className="flex w-full items-center gap-3 border-b border-border p-3.5 last:border-b-0">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-surface-sunken text-base text-secondary">
        🔔
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-primary">{t('profile.notifications')}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      {canToggle ? (
        <button
          type="button"
          role="switch"
          aria-checked={isSubscribed}
          aria-label={t('profile.notificationsToggle')}
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
