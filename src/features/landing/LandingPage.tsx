import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { config } from '@/lib/config.ts';
import { TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY } from '@/features/plan/tempFreeUnlocks.ts';

/**
 * Public marketing landing — what a logged-OUT visitor sees at "/". Pure presentation: no API
 * calls, so it paints instantly without the backend. Its own `landing-*` palette (warm ink, paper,
 * the brand orange) keeps it apart from the in-app theme.
 *
 * <p>Every phone on the page is a REAL screen of the app (`public/landing/shot-*.webp`, re-shot by
 * `npm run landing:shots` against fixtures), in a CSS frame. The page is a promise the app has to
 * keep, so it shows the app, not an illustration of one.</p>
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-white font-sans text-landing-ink antialiased">
      <LandingNav />
      <Hero />
      <Features />
      <HowItWorks />
      <Audience />
      <Control />
      <Faq />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}

/** The screens, all 390 × 844 at 3× (1170 × 2532). */
const SHOT = { w: 1170, h: 2532 };

const CTA_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-landing-amber px-6 py-3.5 text-base font-semibold text-white shadow-[0_8px_20px_-8px_rgba(224,108,0,0.6)] transition hover:-translate-y-px hover:bg-landing-amber-deep';

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span
      className={
        'flex items-center gap-2 text-xl font-extrabold tracking-tight ' +
        (light ? 'text-white' : 'text-landing-ink')
      }
    >
      <span
        className={
          'grid h-8 w-8 place-items-center rounded-lg text-[17px] font-extrabold ' +
          (light ? 'bg-white text-landing-amber' : 'bg-landing-amber text-white')
        }
        aria-hidden
      >
        M
      </span>
      Majstr.pro
    </span>
  );
}

function LandingNav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const links = [
    { href: '#features', label: t('landing.navFeatures') },
    { href: '#how', label: t('landing.navHow') },
    { href: '#faq', label: t('landing.navFaq') },
  ];
  return (
    <nav className="sticky top-0 z-50 border-b border-landing-line/60 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark />
        <div className="hidden items-center gap-8 text-sm font-medium text-landing-muted lg:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-landing-ink">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {/* «Увійти» is always on screen: masters open the landing to get INTO their account too. */}
          <Link
            to={routes.login}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-landing-ink hover:text-landing-amber-deep"
          >
            {t('landing.navSignIn')}
          </Link>
          <Link to={routes.register} className={CTA_CLASS + ' hidden !px-5 !py-2.5 !text-sm lg:inline-flex'}>
            {t('landing.ctaTry')}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-menu"
            aria-label={t('landing.navMenu')}
            className="grid h-10 w-10 place-items-center rounded-lg text-landing-ink lg:hidden"
          >
            <Icon name={open ? 'close' : 'menu'} />
          </button>
        </div>
      </div>
      {open && (
        <div id="landing-menu" className="border-t border-landing-line/60 bg-white px-4 py-2 lg:hidden">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-3 text-base font-medium text-landing-ink"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}

/** A real screen of the app in a CSS phone frame. */
function Phone({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={
        'rounded-[2.2rem] bg-landing-ink p-[7px] shadow-[0_30px_60px_-24px_rgba(58,37,25,0.55)] ' +
        (className ?? '')
      }
    >
      <img
        src={src}
        alt={alt}
        width={SHOT.w}
        height={SHOT.h}
        className="block h-auto w-full rounded-[1.8rem] bg-white"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

function Hero() {
  const { t } = useTranslation();
  const checks = [t('landing.heroCheck1'), t('landing.heroCheck2'), t('landing.heroCheck3'), t('landing.heroCheck4')];
  return (
    // `relative` here and NOT on the inner column at lg: the photo is absolute against the whole
    // header, so it runs to the screen's right edge instead of stopping at the content width.
    <header className="relative overflow-hidden">
      <div className="relative mx-auto max-w-[1160px] px-4 pb-14 pt-8 sm:px-6 lg:static lg:min-h-[620px] lg:pb-20 lg:pt-16">
        <div className="relative z-[1] lg:max-w-[48%]">
          <span className="inline-block rounded-full bg-landing-amber/10 px-3 py-1 text-xs font-semibold text-landing-amber-deep">
            {t('landing.heroBadge')}
          </span>
          <h1 className="mb-4 mt-4 text-[34px] font-extrabold leading-[1.08] tracking-[-0.025em] sm:text-[44px] lg:text-[52px]">
            {t('landing.heroLine1')}
            <br />
            <span className="text-landing-amber">{t('landing.heroLine2')}</span>
            <br />
            {t('landing.heroLine3')}
          </h1>
          <p className="max-w-[32em] text-[17px] text-landing-muted sm:text-lg">{t('landing.heroLede')}</p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 sm:max-w-[30em]">
            {checks.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm font-medium leading-snug">
                <Check />
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link to={routes.register} className={CTA_CLASS + ' w-full sm:w-auto'}>
              {t('landing.ctaTry')} <span aria-hidden>→</span>
            </Link>
            <p className="mt-3 text-sm text-landing-muted">{t('landing.heroNote')}</p>
          </div>
        </div>

        {/* ONE image for every width (a hidden <img> is still downloaded): under the CTA with rounded
            corners on a phone, so the button is on screen without scrolling; the right half of the
            header, edge to edge, on a wide screen. */}
        <div className="relative mt-8 aspect-[4/3] overflow-hidden rounded-3xl lg:absolute lg:inset-y-0 lg:right-0 lg:mt-0 lg:aspect-auto lg:w-[54%] lg:rounded-none">
          <img
            src="/landing/hero-960.webp"
            srcSet={HERO_WIDTHS.map((w) => `/landing/hero-${w}.webp ${w}w`).join(', ')}
            sizes="(min-width: 1024px) 54vw, calc(100vw - 32px)"
            alt={t('landing.heroPhotoAlt')}
            width={1536}
            height={1024}
            fetchPriority="high"
            decoding="async"
            // Face and phone sit in the right two-thirds of the frame, so the crop keeps that side.
            className="h-full w-full object-cover object-[72%_45%]"
          />
          {/* The photo's left edge melts into the page, so the text beside it never sits on a busy
              background. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 hidden w-2/5 bg-gradient-to-r from-white via-white/70 to-transparent lg:block"
            aria-hidden
          />
          <HeroAccent />
        </div>
      </div>
    </header>
  );
}

/** The widths `npm run landing:photos` writes for the hero (scripts/landing-photos.ts). */
const HERO_WIDTHS = [640, 960, 1280, 1536];

/**
 * «Кошторис за 5 хвилин» with an arrow at the phone in the photo — TEXT and SVG over the image,
 * never baked into it, so it stays sharp on any screen. Everything is placed in % of the photo
 * box: the `object-[72%_45%]` crop keeps the phone at about (57 %, 59 %) of that box on a phone, a
 * tablet and a desktop alike, so the arrow is drawn to end just short of it. The arrow stretches
 * with the box (`preserveAspectRatio="none"`) while its stroke does not.
 */
function HeroAccent() {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute inset-0 text-landing-amber-deep" aria-hidden>
      <p
        className="absolute left-[6%] top-[7%] max-w-[50%] -rotate-[7deg] text-[26px] font-semibold leading-[1.05] sm:text-[34px] lg:left-[12%] lg:top-[11%] lg:max-w-none lg:whitespace-nowrap lg:text-[40px]"
        style={{ fontFamily: '"Caveat", "Segoe Print", "Bradley Hand", cursive' }}
      >
        {t('landing.heroAccent')}
      </p>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute left-[18%] top-[31%] h-[22%] w-[33%] lg:left-[24%] lg:top-[24%] lg:h-[29%] lg:w-[27%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 4 C 40 2, 80 30, 96 94" vectorEffect="non-scaling-stroke" />
        <path d="M84 80 L 96 96 L 99 76" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-8 max-w-[40em]">
      <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[32px]">{children}</h2>
      {sub && <p className="mt-2 text-landing-muted">{sub}</p>}
    </div>
  );
}

function Features() {
  const { t } = useTranslation();
  // `pro` marks what a FREE plan genuinely can't reach, so a master who signs up doesn't hit an
  // unannounced paywall. Заміри are PRO in the permanent plan but currently opened to FREE
  // (TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY), so the badge follows that flag and snaps back when
  // the unlock is reverted — keep this consumer in sync with the others (see tempFreeUnlocks.ts).
  // The other five cards are FREE on every plan.
  const measurementsPro = !TEMP_FREE_GETS_MEASUREMENTS_AND_ECONOMY;
  const feats: Array<{ icon: IconName; title: string; text: string; pro: boolean }> = [
    { icon: 'estimate', title: t('landing.feat1Title'), text: t('landing.feat1Text'), pro: false },
    { icon: 'ruler', title: t('landing.feat2Title'), text: t('landing.feat2Text'), pro: measurementsPro },
    { icon: 'link', title: t('landing.feat3Title'), text: t('landing.feat3Text'), pro: false },
    { icon: 'box', title: t('landing.feat4Title'), text: t('landing.feat4Text'), pro: false },
    { icon: 'act', title: t('landing.feat5Title'), text: t('landing.feat5Text'), pro: false },
    { icon: 'wallet', title: t('landing.feat6Title'), text: t('landing.feat6Text'), pro: false },
  ];
  return (
    <section id="features" className="scroll-mt-20 px-4 pb-16 sm:px-6 lg:pb-20">
      <div className="mx-auto max-w-[1160px]">
        <SectionTitle>{t('landing.featuresTitle')}</SectionTitle>
        {/* A phone gets a list: icon, title, one line — a grid of six would lose the descriptions. */}
        <ul className="divide-y divide-landing-line/60 overflow-hidden rounded-2xl border border-landing-line/60 sm:grid sm:grid-cols-2 sm:gap-4 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 lg:grid-cols-3 xl:grid-cols-6">
          {feats.map((f) => (
            <li
              key={f.title}
              className="flex items-start gap-3 bg-white p-4 sm:flex-col sm:rounded-2xl sm:border sm:border-landing-line/60 sm:p-5 sm:shadow-[0_6px_20px_-14px_rgba(58,37,25,0.35)]"
            >
              <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-landing-amber/10 text-landing-amber-deep sm:h-12 sm:w-12">
                <Icon name={f.icon} />
              </span>
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold">
                  {f.title}
                  {f.pro && (
                    <span className="rounded-full border border-landing-line px-1.5 py-px text-[10px] font-bold tracking-wider text-landing-muted">
                      {t('landing.proBadge')}
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-sm leading-snug text-landing-muted">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const steps: Array<{ icon: IconName; title: string; text: string }> = [
    { icon: 'box', title: t('landing.step1Title'), text: t('landing.step1Text') },
    { icon: 'estimate', title: t('landing.step2Title'), text: t('landing.step2Text') },
    { icon: 'link', title: t('landing.step3Title'), text: t('landing.step3Text') },
    { icon: 'sign', title: t('landing.step4Title'), text: t('landing.step4Text') },
  ];
  return (
    <section id="how" className="scroll-mt-20 bg-landing-paper/50 px-4 py-16 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-[1160px]">
        <SectionTitle sub={t('landing.stepsSubtitle')}>{t('landing.stepsTitle')}</SectionTitle>
        <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4 lg:flex-col">
              <div className="flex flex-shrink-0 items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-landing-amber text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <span className="hidden h-9 w-9 place-items-center rounded-full bg-white text-landing-amber-deep lg:grid">
                  <Icon name={s.icon} small />
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-landing-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Audience() {
  const { t } = useTranslation();
  // The nine trades the default catalogue ships (Trade enum minus GENERAL/OTHER) — they are search
  // queries too («кошторис електрика»), so they stay on the page as visible text.
  const trades = [
    t('landing.tradeTile'), t('landing.tradeElectric'), t('landing.tradePlumb'),
    t('landing.tradePaint'), t('landing.tradeBuilder'), t('landing.tradeDrywall'),
    t('landing.tradeFloor'), t('landing.tradeDemo'), t('landing.tradeMetal'),
  ];
  const cards = [
    {
      title: t('landing.forMasterTitle'),
      points: [t('landing.forMaster1'), t('landing.forMaster2'), t('landing.forMaster3')],
      photo: { name: 'card-master', widths: [640, 960], position: 'object-[50%_55%]' },
      photoAlt: t('landing.forMasterPhotoAlt'),
    },
    {
      title: t('landing.forForemanTitle'),
      points: [t('landing.forForeman1'), t('landing.forForeman2'), t('landing.forForeman3')],
      photo: { name: 'card-brigadir', widths: [640, 960, 1280], position: 'object-[50%_40%]' },
      photoAlt: t('landing.forForemanPhotoAlt'),
    },
    {
      title: t('landing.forClientTitle'),
      points: [t('landing.forClient1'), t('landing.forClient2'), t('landing.forClient3')],
      photo: { name: 'card-client', widths: [640], position: 'object-[50%_30%]' },
      photoAlt: t('landing.forClientPhotoAlt'),
    },
  ];
  return (
    <section className="px-4 py-16 sm:px-6 lg:py-20">
      <div className="mx-auto max-w-[1160px]">
        <SectionTitle sub={t('landing.audienceSubtitle')}>{t('landing.audienceTitle')}</SectionTitle>
        <div className="grid gap-5 md:grid-cols-3">
          {cards.map((c) => (
            <article
              key={c.title}
              className="overflow-hidden rounded-2xl border border-landing-line/60 bg-white shadow-[0_6px_20px_-14px_rgba(58,37,25,0.35)]"
            >
              {/* The owner's photo (design/landing → `npm run landing:photos`): 16:10 in one column — a
                  240 px strip across a tablet cut the phone out of the shot — and a level 240 px in the
                  three-card row. `widths` are what the script could make (it never upscales; the
                  originals run 694-1536 px), `position` keeps each face and phone in the crop. */}
              <img
                src={`/landing/${c.photo.name}-640.webp`}
                srcSet={c.photo.widths.map((w) => `/landing/${c.photo.name}-${w}.webp ${w}w`).join(', ')}
                sizes="(min-width: 768px) 360px, calc(100vw - 32px)"
                width={640}
                height={427}
                loading="lazy"
                decoding="async"
                alt={c.photoAlt}
                className={`aspect-[16/10] w-full object-cover ${c.photo.position} md:aspect-auto md:h-[240px]`}
              />
              <div className="p-5">
                <h3 className="text-lg font-bold">{c.title}</h3>
                <ul className="mt-3 space-y-2">
                  {c.points.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm leading-snug text-landing-muted">
                      <Check />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-sm text-landing-muted">
          <span className="font-semibold text-landing-ink">{t('landing.tradesNote')}</span>{' '}
          {trades.join(' · ')}
        </p>
      </div>
    </section>
  );
}

function Control() {
  const { t } = useTranslation();
  const points = [t('landing.control1'), t('landing.control2'), t('landing.control3')];
  return (
    <section className="px-4 pb-16 sm:px-6 lg:pb-20">
      <div className="mx-auto grid max-w-[1160px] items-center gap-10 overflow-hidden rounded-3xl bg-landing-paper/60 px-5 py-10 sm:px-10 lg:grid-cols-2 lg:py-12">
        {/* The owner's blurred site photo (pro-bg) behind the two real screens — decorative, so alt="". */}
        <div className="relative flex justify-center gap-4 overflow-hidden rounded-2xl px-4 py-8">
          <img
            src="/landing/pro-bg-640.webp"
            srcSet="/landing/pro-bg-640.webp 640w, /landing/pro-bg-960.webp 960w"
            sizes="(min-width: 1024px) 540px, calc(100vw - 72px)"
            width={640}
            height={636}
            loading="lazy"
            decoding="async"
            alt=""
            className="absolute inset-0 -z-0 h-full w-full object-cover"
          />
          <Phone src="/landing/shot-share.webp" alt={t('landing.shotShareAlt')} className="relative w-[44%] max-w-[210px]" />
          <Phone
            src="/landing/shot-money.webp"
            alt={t('landing.shotMoneyAlt')}
            className="relative mt-10 w-[44%] max-w-[210px]"
          />
        </div>
        <div>
          <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[32px]">
            {t('landing.controlTitle')}
          </h2>
          <ul className="mt-6 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2 text-base">
                <Check />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Visible FAQ — an accordion of the questions a master actually asks. The text here is mirrored
 * WORD-FOR-WORD by the FAQPage JSON-LD in index.html (same eight Q/A, in Ukrainian, the default
 * render language): structured data that describes content not visible on the page is a policy
 * violation, so change one and change the other in the same commit. Accordions are an allowed FAQ
 * pattern — the answers are in the DOM even while collapsed, so crawlers still read them.
 */
export const FAQ_COUNT = 8;

function Faq() {
  const { t } = useTranslation();
  const items = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    q: t(`landing.faqQ${i + 1}`),
    a: t(`landing.faqA${i + 1}`),
  }));
  return (
    <section id="faq" className="scroll-mt-20 px-4 pb-16 sm:px-6 lg:pb-20">
      <div className="mx-auto max-w-[760px]">
        <SectionTitle>{t('landing.faqTitle')}</SectionTitle>
        <div className="space-y-3">
          {items.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-landing-line/60 bg-white px-5 py-1 transition open:border-landing-amber/60"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-bold marker:hidden">
                {item.q}
                <span
                  aria-hidden
                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-landing-amber/10 text-landing-amber-deep transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-4 pr-8 text-[15px] leading-relaxed text-landing-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { t } = useTranslation();
  return (
    <section className="px-4 pb-12 sm:px-6">
      <div className="mx-auto flex max-w-[1160px] flex-col items-start gap-6 rounded-3xl bg-landing-amber px-6 py-8 text-white sm:px-10 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl">{t('landing.finalTitle')}</h2>
          <p className="mt-1 text-white/90">{t('landing.finalText')}</p>
        </div>
        <Link
          to={routes.register}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-landing-amber-deep transition hover:-translate-y-px sm:w-auto"
        >
          {t('landing.ctaTry')} <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-landing-line/60 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-3 text-sm text-landing-muted md:flex-row md:items-center md:justify-between">
        <span>{t('landing.footerCopyright')}</span>
        <div>
          {t('landing.footerSupport')}{' '}
          <a href={`mailto:${config.supportEmail}`} className="text-landing-ink hover:text-landing-amber-deep">
            {config.supportEmail}
          </a>{' '}
          ·{' '}
          <a
            href={`tel:${config.supportPhone.replace(/[^+\d]/g, '')}`}
            className="text-landing-ink hover:text-landing-amber-deep"
          >
            {config.supportPhone}
          </a>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {/* Separate documents, not app routes — a <Link> would land in the SPA's catch-all. */}
          <a href="/kalkulyator-plytky" className="text-landing-ink hover:text-landing-amber-deep">
            {t('landing.footerCalcTile')}
          </a>
          <a href="/kalkulyator-gipsokartonu" className="text-landing-ink hover:text-landing-amber-deep">
            {t('landing.footerCalcDrywall')}
          </a>
          <Link to={routes.privacy} className="text-landing-ink hover:text-landing-amber-deep">
            {t('privacy.footerLink')}
          </Link>
        </div>
        {/* -ml: the 44 px tap target is wider than the icon, so the icon lines up with the text above. */}
        <div className="-ml-2.5 flex items-center gap-1 md:ml-0">
          <a
            href={config.youtubeUrl}
            target="_blank"
            rel="noopener"
            aria-label={t('landing.footerYoutube')}
            title={t('landing.footerYoutube')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-landing-ink hover:text-landing-amber-deep"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
              <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8ZM9.8 15.1V8.9l5.8 3.1-5.8 3.1Z" />
            </svg>
          </a>
          <a
            href={config.telegramUrl}
            target="_blank"
            rel="noopener"
            aria-label={t('landing.footerTelegram')}
            title={t('landing.footerTelegram')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-landing-ink hover:text-landing-amber-deep"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
              <path d="M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.5 1 12c-1.1-.3-1.1-1.1.2-1.6L20.5 3c.9-.3 1.7.2 1.4 1.3Z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}

function Check() {
  return (
    <span
      aria-hidden
      className="mt-px grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-landing-amber text-[11px] font-extrabold text-white"
    >
      ✓
    </span>
  );
}

type IconName = 'estimate' | 'ruler' | 'link' | 'box' | 'act' | 'wallet' | 'sign' | 'menu' | 'close';

/** Line icons drawn inline — the landing ships no icon library. */
function Icon({ name, small = false }: { name: IconName; small?: boolean }) {
  const paths: Record<IconName, ReactNode> = {
    estimate: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    ruler: (
      <>
        <path d="M3 17 17 3l4 4L7 21z" />
        <path d="m7 13 2 2M10 10l2 2M13 7l2 2" />
      </>
    ),
    link: (
      <>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </>
    ),
    act: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 14l2 2 4-4" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M3 10h18M16 15h2M6 6l9-3 1 3" />
      </>
    ),
    sign: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
  };
  const size = small ? 18 : 22;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
