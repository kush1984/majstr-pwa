import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserResponse } from '@/api/types.ts';

/**
 * These tests guard the two promises the privacy policy now makes in writing: nothing is captured
 * before consent, and no personal data leaves the device. Both are one-line mistakes to make and
 * invisible afterwards — the only other way to notice is to watch your own recording.
 */

const ph = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('posthog-js', () => ({ posthog: ph }));

/** Re-import the module with a fresh env — it keeps the loaded SDK in module state. */
async function load(key: string) {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  vi.stubEnv('VITE_POSTHOG_HOST', 'https://eu.i.posthog.com');
  return import('./posthog.ts');
}

function master(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: 'u-1', email: 'master@example.com', fullName: 'Петро Коваль',
    trades: ['PAINTER'], customTrades: [], phone: '+380671112233',
    companyName: 'ФОП Коваль', logoUrl: null, plan: 'FREE', role: 'USER', emailVerified: false,
    createdAt: '2026-01-01', consentedToPrivacyAt: '2026-01-02', acknowledgedClientDataAt: null,
    planExpiresAt: null, autoRenew: false, cardMask: null, trialStartedAt: null,
    referralCode: 'r1', legalName: null, taxId: null, legalAddress: null, iban: null,
    bankName: null, vatPayer: false, vatId: null, taxGroup: null, taxRate: null, docCity: null,
    actNumberFormat: 'PLAIN',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(ph)) fn.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('disabled by default', () => {
  it('never loads or initialises the SDK without a key', async () => {
    const mod = await load('');
    mod.initPostHog();
    await Promise.resolve();
    expect(ph.init).not.toHaveBeenCalled();
  });

  it('every entry point is a silent no-op when disabled', async () => {
    const mod = await load('');
    mod.initPostHog();
    // A capture must never be the reason a working flow throws.
    expect(() => mod.track('act_created')).not.toThrow();
    expect(() => mod.applyAnalyticsIdentity(master())).not.toThrow();
    expect(() => mod.resetAnalytics()).not.toThrow();
    await Promise.resolve();
    expect(ph.capture).not.toHaveBeenCalled();
    expect(ph.identify).not.toHaveBeenCalled();
  });
});

describe('init options', () => {
  it('starts opted out, with autocapture off and masking INSIDE session_recording', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    await vi.waitFor(() => expect(ph.init).toHaveBeenCalled());

    const [key, opts] = ph.init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe('phc_test');
    expect(opts.api_host).toBe('https://eu.i.posthog.com');
    expect(opts.opt_out_capturing_by_default).toBe(true);
    // Autocapture ships the TEXT of whatever was clicked — a client's name inside an event name.
    expect(opts.autocapture).toBe(false);
    expect(opts.capture_pageview).toBe(false);

    // Put at the top level these are silently ignored, and the recording looks fine until you
    // watch it. Assert their nesting, not just their presence.
    const rec = opts.session_recording as Record<string, unknown>;
    expect(rec.maskAllInputs).toBe(true);
    expect(rec.maskTextSelector).toBe('.ph-mask');
    expect(opts).not.toHaveProperty('maskAllInputs');
  });

  it('initialises once, however many times it is called', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.initPostHog();
    await vi.waitFor(() => expect(ph.init).toHaveBeenCalledTimes(1));
  });
});

describe('consent gate', () => {
  it('an unconsented master is opted out and NOT identified', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.applyAnalyticsIdentity(master({ consentedToPrivacyAt: null }));
    await vi.waitFor(() => expect(ph.opt_out_capturing).toHaveBeenCalled());
    expect(ph.opt_in_capturing).not.toHaveBeenCalled();
    expect(ph.identify).not.toHaveBeenCalled();
  });

  it('a consented master opts in and is identified by UUID only', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.applyAnalyticsIdentity(master());
    await vi.waitFor(() => expect(ph.identify).toHaveBeenCalled());
    expect(ph.opt_in_capturing).toHaveBeenCalled();

    const [id, props] = ph.identify.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('u-1');
    const serialized = JSON.stringify(props);
    for (const pii of ['master@example.com', 'Петро Коваль', '+380671112233', 'ФОП Коваль']) {
      expect(serialized).not.toContain(pii);
    }
  });
});

describe('person properties', () => {
  it('folds a master-invented trade into OTHER and never sends its free-text name', async () => {
    const mod = await load('phc_test');
    const props = mod.personProperties(master({
      trades: ['PAINTER'],
      customTrades: [{ id: 'ct1', name: 'Ремонти від Петра К.', sortOrder: 0 }],
    }));
    expect(props.trades).toEqual(['PAINTER', 'OTHER']);
    expect(JSON.stringify(props)).not.toContain('Ремонти від Петра К.');
  });

  it('carries the first-touch tags this device stored, and nothing when it stored none', async () => {
    const mod = await load('phc_test');
    expect(mod.personProperties(master()).referral_source).toBeUndefined();
    expect(mod.personProperties(master()).utm_source).toBeUndefined();

    localStorage.setItem('majstr.ref', 'liga');
    localStorage.setItem('majstr.utm', JSON.stringify({ utmSource: 'tiktok' }));
    const props = mod.personProperties(master());
    expect(props.referral_source).toBe('liga');
    expect(props.utm_source).toBe('tiktok');
  });
});

describe('logout', () => {
  it('resets the identity — a crew shares one phone', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.applyAnalyticsIdentity(master());
    await vi.waitFor(() => expect(ph.identify).toHaveBeenCalled());

    mod.resetAnalytics();
    // Without this the next person to log in is appended to the previous master's person, and
    // their session recording is filed under them.
    await vi.waitFor(() => expect(ph.reset).toHaveBeenCalledTimes(1));
  });
});

describe('events', () => {
  it('sends the event name and its properties verbatim', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.track('estimate_shared', { scope: 'object', channel: 'email' });
    await vi.waitFor(() => expect(ph.capture).toHaveBeenCalledWith(
      'estimate_shared', { scope: 'object', channel: 'email' }));
  });

  it('a propertyless event carries no properties', async () => {
    const mod = await load('phc_test');
    mod.initPostHog();
    mod.track('act_created');
    await vi.waitFor(() => expect(ph.capture).toHaveBeenCalledWith('act_created', undefined));
  });
});
