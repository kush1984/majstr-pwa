/**
 * Fixture builders for the API shapes tests mock most often.
 *
 * Why these exist: `UserResponse` alone was hand-rolled in four test files, so every field
 * added to it (privacy consent, plan expiry, auto-renew, trial, referral code — seven so far)
 * broke all four at once. Since the test sources were not type-checked in CI, they did not
 * break loudly; they broke *invisibly*, and a mock missing the field a component reads under
 * test would silently render the "not set" branch forever.
 *
 * A factory fixes that at the root: add a field to the interface, give it a default here
 * once, and every test keeps compiling while still exercising the real shape. Tests override
 * only the fields they actually assert on, which also makes each test's intent obvious.
 *
 * Deliberately no `as` casts anywhere below — the return types are declared, so if an
 * interface changes, THIS file is what fails to compile. That is the whole point: one loud
 * failure in one place instead of a silent drift spread across the suite.
 *
 * Defaults are the boring "nothing special about this account" case — FREE plan, verified,
 * nothing consented. Anything a test asserts on it must pass explicitly.
 */
import type {
  EstimateResponse,
  MeasurementRoom,
  PlanLimits,
  ProjectImportFloor,
  ProjectImportRoom,
  UserResponse,
} from '../api/types';

export function aUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: 'u1',
    email: 'master@example.com',
    fullName: 'Іван Майстер',
    trades: ['ELECTRICAL'],
    customTrades: [],
    phone: '+380671112233',
    companyName: 'ФОП Іван',
    logoUrl: null,
    plan: 'FREE',
    role: 'USER',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00Z',
    consentedToPrivacyAt: null,
    acknowledgedClientDataAt: null,
    planExpiresAt: null,
    autoRenew: false,
    cardMask: null,
    trialStartedAt: null,
    referralCode: 'abc123',
    legalName: null,
    taxId: null,
    legalAddress: null,
    iban: null,
    bankName: null,
    vatPayer: false,
    vatId: null,
    taxGroup: null,
    taxRate: null,
    docCity: null,
    actNumberFormat: 'PLAIN',
    ...overrides,
  };
}

export function aPlanLimits(overrides: Partial<PlanLimits> = {}): PlanLimits {
  return {
    plan: 'FREE',
    maxProjects: 3,
    projectsUsed: 0,
    maxEstimatesPerProject: 2,
    maxPhotosPerObject: 10,
    maxReceiptPhotosPerObject: 10,
    ...overrides,
  };
}

export function anEstimate(overrides: Partial<EstimateResponse> = {}): EstimateResponse {
  return {
    id: 'e1',
    projectId: 'p1',
    name: null,
    status: 'DRAFT',
    validUntil: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    items: [],
    worksSubtotal: 0,
    materialsSubtotal: 0,
    total: 0,
    balance: 0,
    ...overrides,
  };
}

/** `floor` became mandatory when rooms were grouped by storey; null = ungrouped. */
export function aMeasurementRoom(overrides: Partial<MeasurementRoom> = {}): MeasurementRoom {
  return {
    id: 'r1',
    name: 'Кімната',
    floor: null,
    sortOrder: 0,
    items: [],
    areaTotal: 0,
    linearTotal: 0,
    pieceTotal: 0,
    ...overrides,
  };
}

/** The import model gained explicit gabarits (width/length/cut/ceiling) in editor v2. */
export function anImportRoom(overrides: Partial<ProjectImportRoom> = {}): ProjectImportRoom {
  return {
    number: '1',
    name: 'Кімната',
    areaM2: null,
    perimeterMm: null,
    wallSegmentsMm: null,
    widthMm: null,
    lengthMm: null,
    cutWidthMm: null,
    cutDepthMm: null,
    ceilingHmm: null,
    openings: [],
    confidence: 'high',
    note: null,
    ...overrides,
  };
}

export function anImportFloor(overrides: Partial<ProjectImportFloor> = {}): ProjectImportFloor {
  return {
    floor: null,
    roomsOnThisSheet: [],
    rooms: [],
    ...overrides,
  };
}
