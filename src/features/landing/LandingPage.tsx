import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '@/lib/config.ts';
import { config } from '@/lib/config.ts';

/**
 * Public marketing landing — what a logged-OUT visitor sees at "/". Pure
 * presentation: no API calls, so it paints instantly without the backend.
 * Visual identity is its own (graphite + warm paper + construction yellow,
 * technical-drawing feel) via the `landing-*` Tailwind palette — deliberately
 * distinct from the in-app theme. Reproduces docs reference majstr-landing.html.
 */
export function LandingPage() {
  return (
    <div className="min-h-dvh bg-landing-paper font-sans text-landing-ink antialiased">
      <LandingNav />
      <Hero />
      <TradesStrip />
      <ProblemSolution />
      <Features />
      <HowItWorks />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}

/** Construction-yellow monospace label that opens most sections. */
function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={
        'font-mono text-xs font-semibold uppercase tracking-[0.18em] text-landing-amber-deep ' +
        (className ?? '')
      }
    >
      {children}
    </span>
  );
}

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <div
      className={
        'flex items-center gap-2.5 text-xl font-extrabold tracking-tight ' +
        (light ? 'text-landing-paper' : 'text-landing-ink')
      }
    >
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[7px] bg-landing-ink font-mono text-[17px] font-extrabold text-landing-amber">
        M
      </span>
      Majstr
    </div>
  );
}

function LandingNav() {
  const { t } = useTranslation();
  return (
    <nav className="sticky top-0 z-50 border-b border-landing-line bg-landing-paper/[0.86] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-6">
        <Wordmark />
        <Link
          to={routes.login}
          className="rounded-lg bg-landing-ink px-[18px] py-[9px] text-sm font-semibold text-white transition-colors hover:bg-landing-ink-2"
        >
          {t('landing.navSignIn')}
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  const { t } = useTranslation();
  return (
    <header className="relative overflow-hidden px-6 pb-16 pt-[72px]">
      <div className="mx-auto grid max-w-[1120px] items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <Eyebrow>{t('landing.heroEyebrow')}</Eyebrow>
          <h1 className="my-[18px] text-[33px] font-extrabold leading-[1.04] tracking-[-0.025em] sm:text-[40px] lg:text-[54px]">
            {t('landing.heroTitlePre')}
            <span className="relative whitespace-normal after:absolute after:inset-x-[-2px] after:bottom-[6px] after:-z-[1] after:h-[14px] after:-skew-x-6 after:bg-landing-amber/85 after:content-[''] lg:whitespace-nowrap">
              {t('landing.heroTitleHl')}
            </span>
          </h1>
          <p className="mb-[30px] max-w-[30em] text-[19px] text-landing-muted">
            {t('landing.heroLede')}
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              to={routes.register}
              className="inline-flex items-center gap-2 rounded-[10px] bg-landing-ink px-[26px] py-3.5 text-base font-semibold text-white transition hover:-translate-y-px hover:bg-landing-ink-2"
            >
              {t('landing.ctaPrimary')}
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-[10px] border-[1.5px] border-landing-line px-[26px] py-3.5 text-base font-semibold text-landing-ink transition hover:border-landing-ink"
            >
              {t('landing.ctaHow')}
            </a>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[13.5px] text-landing-muted">
            <span className="h-[7px] w-[7px] rounded-full bg-[#3fa650] shadow-[0_0_0_3px_rgba(63,166,80,0.18)]" />
            {t('landing.heroNote')}
          </div>
        </div>

        <PhoneMockup />
      </div>
    </header>
  );
}

function PhoneMockup() {
  const { t } = useTranslation();
  return (
    <div className="relative order-first flex justify-center lg:order-none">
      {/* faint technical grid behind the phone, faded out at the edges */}
      <div
        className="pointer-events-none absolute -inset-10 z-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--l-line)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--l-line)) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          WebkitMaskImage: 'radial-gradient(circle at center, #000 35%, transparent 72%)',
          maskImage: 'radial-gradient(circle at center, #000 35%, transparent 72%)',
        }}
      />
      <div className="relative z-[1] w-[288px] rounded-[34px] bg-landing-ink p-[11px] shadow-[0_30px_60px_-20px_rgba(58,37,25,0.5)]">
        <div className="overflow-hidden rounded-[24px] bg-white">
          <div className="bg-landing-ink px-[18px] pb-3.5 pt-4 text-white">
            <div className="text-[15px] font-bold">{t('landing.mockupCo')}</div>
            <div className="mt-0.5 font-mono text-xs text-[#9fb0c0]">{t('landing.mockupPhone')}</div>
          </div>
          <div className="px-[18px] py-4">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-landing-amber-deep">
              {t('landing.mockupObjLabel')}
            </div>
            <div className="mb-0.5 mt-1 text-[15px] font-bold">{t('landing.mockupObjName')}</div>
            <div className="mb-3.5 text-xs text-landing-muted">{t('landing.mockupObjAddr')}</div>
            <MockRow name={t('landing.mockupRow1')} amount={t('landing.mockupRow1Amt')} />
            <MockRow name={t('landing.mockupRow2')} amount={t('landing.mockupRow2Amt')} />
            <MockRow name={t('landing.mockupRow3')} amount={t('landing.mockupRow3Amt')} />
            <div className="mt-3 flex items-center justify-between border-t-2 border-landing-ink pt-3">
              <span className="text-sm font-extrabold">{t('landing.mockupTotal')}</span>
              <span className="font-mono text-[18px] font-extrabold">{t('landing.mockupTotalAmt')}</span>
            </div>
            <div className="mt-3.5 rounded-[10px] bg-landing-amber px-3 py-[11px] text-center text-[13px] font-bold text-landing-ink">
              {t('landing.mockupSign')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockRow({ name, amount }: { name: string; amount: string }) {
  return (
    <div className="flex justify-between border-t border-[#eee] py-2 text-[12.5px]">
      <span className="text-landing-ink">{name}</span>
      <span className="whitespace-nowrap font-mono font-semibold">{amount}</span>
    </div>
  );
}

function TradesStrip() {
  const { t } = useTranslation();
  const trades = [
    t('landing.tradeElectric'),
    t('landing.tradeTile'),
    t('landing.tradePlumb'),
    t('landing.tradePaint'),
    t('landing.tradeAny'),
  ];
  return (
    <div className="border-y border-landing-line bg-white">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-x-10 gap-y-3.5 px-6 py-5">
        {trades.map((trade) => (
          <span
            key={trade}
            className="flex items-center gap-2.5 font-mono text-[13px] font-medium text-landing-ink"
          >
            <b className="text-landing-amber-deep">//</b>
            {trade}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-12 max-w-[34em]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="my-3.5 text-[32px] font-extrabold leading-[1.1] tracking-[-0.02em] sm:text-[38px]">
        {title}
      </h2>
      {subtitle && <p className="text-lg text-landing-muted">{subtitle}</p>}
    </div>
  );
}

function ProblemSolution() {
  const { t } = useTranslation();
  const bad = [t('landing.bad1'), t('landing.bad2'), t('landing.bad3'), t('landing.bad4')];
  const good = [t('landing.good1'), t('landing.good2'), t('landing.good3'), t('landing.good4')];
  return (
    <section className="px-6 py-16 sm:py-[84px]">
      <div className="mx-auto max-w-[1120px]">
        <SectionHead
          eyebrow={t('landing.problemEyebrow')}
          title={t('landing.problemTitle')}
          subtitle={t('landing.problemSubtitle')}
        />
        <div className="grid overflow-hidden rounded-2xl border border-landing-line md:grid-cols-2">
          <div className="bg-white px-[30px] py-[34px] sm:px-9 sm:py-[38px]">
            <div className="mb-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[#a85432]">
              {t('landing.badTag')}
            </div>
            {bad.map((item) => (
              <PsItem key={item} tone="bad" symbol="✕">
                {item}
              </PsItem>
            ))}
          </div>
          <div className="bg-landing-ink px-[30px] py-[34px] text-landing-paper sm:px-9 sm:py-[38px]">
            <div className="mb-5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-landing-amber">
              {t('landing.goodTag')}
            </div>
            {good.map((item) => (
              <PsItem key={item} tone="good" symbol="✓">
                {item}
              </PsItem>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PsItem({
  tone,
  symbol,
  children,
}: {
  tone: 'bad' | 'good';
  symbol: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 text-[15.5px]">
      <span
        className={
          'mt-px grid h-5 w-5 flex-shrink-0 place-items-center rounded-[5px] text-[13px] font-extrabold ' +
          (tone === 'bad'
            ? 'bg-[#eaddd0] text-[#a85432]'
            : 'bg-landing-amber/[0.18] text-landing-amber')
        }
      >
        {symbol}
      </span>
      {children}
    </div>
  );
}

function Features() {
  const { t } = useTranslation();
  const feats = [
    { n: '01', title: t('landing.feature1Title'), text: t('landing.feature1Text') },
    { n: '02', title: t('landing.feature2Title'), text: t('landing.feature2Text') },
    { n: '03', title: t('landing.feature3Title'), text: t('landing.feature3Text') },
    { n: '04', title: t('landing.feature4Title'), text: t('landing.feature4Text') },
  ];
  return (
    <section className="px-6 pb-16 sm:pb-[84px]">
      <div className="mx-auto max-w-[1120px]">
        <SectionHead
          eyebrow={t('landing.featuresEyebrow')}
          title={t('landing.featuresTitle')}
          subtitle={t('landing.featuresSubtitle')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {feats.map((f) => (
            <div
              key={f.n}
              className="rounded-[14px] border border-landing-line bg-white p-[30px] transition hover:-translate-y-0.5 hover:border-landing-ink"
            >
              <div className="font-mono text-[13px] font-bold text-landing-amber-deep">{f.n}</div>
              <h3 className="mb-2.5 mt-3.5 text-xl font-bold tracking-[-0.01em]">{f.title}</h3>
              <p className="text-[15px] text-landing-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    { n: '1', title: t('landing.step1Title'), text: t('landing.step1Text') },
    { n: '2', title: t('landing.step2Title'), text: t('landing.step2Text') },
    { n: '3', title: t('landing.step3Title'), text: t('landing.step3Text') },
  ];
  return (
    <section id="how" className="px-6 pb-16 sm:pb-[84px]">
      <div className="mx-auto max-w-[1120px]">
        <div className="rounded-[20px] bg-landing-ink px-7 py-11 text-landing-paper sm:px-12 sm:py-[60px]">
          <Eyebrow className="!text-landing-amber">{t('landing.stepsEyebrow')}</Eyebrow>
          <h2 className="my-3.5 mb-11 text-[28px] font-extrabold tracking-[-0.02em] text-white sm:text-[36px]">
            {t('landing.stepsTitle')}
          </h2>
          <div className="grid gap-9 md:grid-cols-3 md:gap-[30px]">
            {steps.map((s, i) => (
              <div key={s.n} className="relative">
                <div className="mb-[18px] grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-landing-amber font-mono text-sm font-extrabold text-landing-ink">
                  {s.n}
                </div>
                <h4 className="mb-2.5 text-[19px] font-bold">{s.title}</h4>
                <p className="text-[14.5px] text-[#a9b8c6]">{s.text}</p>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-1.5 top-auto text-xl font-bold text-landing-amber md:left-auto md:right-[-22px] md:top-1.5"
                  >
                    <span className="md:hidden">↓</span>
                    <span className="hidden md:inline">→</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  const { t } = useTranslation();
  return (
    <section className="px-6 py-20 text-center sm:py-24">
      <div className="mx-auto max-w-[1120px]">
        <Eyebrow>{t('landing.finalEyebrow')}</Eyebrow>
        <h2 className="mx-auto mb-[18px] mt-3.5 max-w-[18em] text-[32px] font-extrabold leading-[1.08] tracking-[-0.025em] sm:text-[44px]">
          {t('landing.finalTitle')}
        </h2>
        <p className="mx-auto mb-8 max-w-[30em] text-[19px] text-landing-muted">
          {t('landing.finalText')}
        </p>
        <Link
          to={routes.register}
          className="inline-flex items-center gap-2 rounded-[10px] bg-landing-ink px-[26px] py-3.5 text-base font-semibold text-white transition hover:-translate-y-px hover:bg-landing-ink-2"
        >
          {t('landing.ctaPrimary')}
        </Link>
      </div>
    </section>
  );
}

function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-landing-line bg-white px-6 py-10">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-[18px]">
        <Wordmark />
        <div className="font-mono text-sm text-landing-muted">
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
        <div className="flex items-center gap-3 font-mono text-sm text-landing-muted">
          <Link to={routes.privacy} className="text-landing-ink hover:text-landing-amber-deep">
            {t('privacy.footerLink')}
          </Link>
          <span aria-hidden>·</span>
          <span>{t('landing.footerCopyright')}</span>
        </div>
      </div>
    </footer>
  );
}
