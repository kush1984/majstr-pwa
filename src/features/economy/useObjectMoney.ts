import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { economyApi } from '@/api/economy.ts';
import { paymentsApi } from '@/api/payments.ts';
import { cashApi } from '@/api/cash.ts';
import { roundMoney } from '@/lib/decimal.ts';
import { newUuid } from '@/lib/uuid.ts';
import { offlineMutate } from '@/lib/outbox/offlineMutation.ts';
import { invalidateObjectMoney } from './useEconomy.ts';
import type {
  CashEntryKind,
  CashEntryRequest,
  CashEntryResponse,
  ExpenseRequest,
  ExpenseResponse,
  ObjectMoneyResponse,
  PaymentReceiptRequest,
  PaymentReceiptResponse,
} from '@/api/types.ts';

export const objectMoneyKey = (objectId: string) => ['object-money', objectId] as const;

/**
 * «Гроші обʼєкта» — the object's rows of «Мої гроші», over its whole life, with the same arithmetic.
 * Read-only on the server side of things: every write below goes through the object's OWN doors
 * (a payment, an expense) or through «Мої гроші»'s edit door for a row that already exists.
 */
export function useObjectMoney(objectId: string) {
  return useQuery({
    queryKey: objectMoneyKey(objectId),
    queryFn: () => economyApi.money(objectId),
    enabled: Boolean(objectId),
  });
}

/** What one row moves — the server's rule: the client's material money is in no total. */
function moved(row: CashEntryResponse) {
  const client = row.clientMaterial === true;
  return {
    income: !client && row.direction === 'INCOME' ? row.amount : 0,
    expense: !client && row.direction === 'EXPENSE' ? row.amount : 0,
    given: client && row.direction === 'INCOME' ? row.amount : 0,
    bought: client && row.direction === 'EXPENSE' ? row.amount : 0,
  };
}

/**
 * The card after one row moved — by the DELTA of that row, never by re-adding what is on screen
 * (the list is cut at 500 while the totals cover everything). Only ever visible offline: online the
 * refetch behind every write replaces it with the server's figures.
 */
export function applyMoneyDelta(
  money: ObjectMoneyResponse,
  change: { removed?: CashEntryResponse | null; added?: CashEntryResponse | null },
): ObjectMoneyResponse {
  const out = change.removed ? moved(change.removed) : { income: 0, expense: 0, given: 0, bought: 0 };
  const inc = change.added ? moved(change.added) : { income: 0, expense: 0, given: 0, bought: 0 };
  const income = roundMoney(money.income - out.income + inc.income);
  const expense = roundMoney(money.expense - out.expense + inc.expense);
  const given = roundMoney(money.materials.given - out.given + inc.given);
  const bought = roundMoney(money.materials.bought - out.bought + inc.bought);
  let entries = money.entries.filter((e) => e.id !== change.removed?.id && e.id !== change.added?.id);
  if (change.added) {
    const at = entries.findIndex((e) => e.happenedOn <= change.added!.happenedOn);
    entries = [...entries];
    entries.splice(at === -1 ? entries.length : at, 0, change.added);
  }
  return {
    ...money,
    income,
    expense,
    earned: roundMoney(income - expense),
    materials: { ...money.materials, given, bought, outstanding: roundMoney(bought - given) },
    crewRecorded: money.crewRecorded || change.added?.category === 'CREW',
    entries,
  };
}

function patch(qc: QueryClient, objectId: string, change: Parameters<typeof applyMoneyDelta>[1]) {
  qc.setQueryData<ObjectMoneyResponse>(objectMoneyKey(objectId), (old) =>
    (old ? applyMoneyDelta(old, change) : old));
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * «Отримав» on the object — an object payment with no plan stage, offline-first through the same
 * outbox entity the payments card always used. `materialRefund` is the client's money «на матеріал».
 */
export function useAddObjectIncome(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: PaymentReceiptRequest) => {
      const id = newUuid();
      return offlineMutate<PaymentReceiptResponse[]>({
        entity: 'payment-receipt', entityId: id, type: 'create', payload: { objectId, req },
        deps: [objectId],
        online: () => paymentsApi.addReceipt(objectId, req, id),
        cancel: () => qc.cancelQueries({ queryKey: objectMoneyKey(objectId) }),
        onOnlineSuccess: () => invalidateObjectMoney(qc, objectId),
        optimistic: () => {
          const refund = req.materialRefund === true;
          patch(qc, objectId, {
            added: {
              id, kind: 'OBJECT_PAYMENT', direction: 'INCOME', amount: req.amount,
              category: null, note: req.label ?? null, happenedOn: req.receivedAt || today(),
              projectId: objectId, materialRefund: refund, clientMaterial: refund,
              noteLocked: false, readOnly: false, hasPhoto: false,
            },
          });
          return [];
        },
      });
    },
  });
}

/** «Витратив» on the object — the object's own expense journal, offline-first. */
export function useAddObjectExpense(objectId: string) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (req: ExpenseRequest) => {
      const id = newUuid();
      return offlineMutate<ExpenseResponse | null>({
        entity: 'expense', entityId: id, type: 'create', payload: { objectId, req },
        deps: [objectId],
        online: () => economyApi.addExpense(objectId, req, id),
        cancel: () => qc.cancelQueries({ queryKey: objectMoneyKey(objectId) }),
        onOnlineSuccess: () => invalidateObjectMoney(qc, objectId),
        optimistic: () => {
          patch(qc, objectId, {
            added: {
              id, kind: 'OBJECT_EXPENSE', direction: 'EXPENSE', amount: req.amount,
              category: req.category === 'LABOR' ? 'CREW' : req.category,
              note: req.note ?? null, happenedOn: req.spentAt || today(), projectId: objectId,
              materialRefund: false, clientMaterial: false, noteLocked: false, readOnly: false,
              hasPhoto: false,
            },
          });
          return null;
        },
      });
    },
  });
}

/**
 * Edit or delete a row the card shows — through «Мої гроші»'s door, which writes back through the
 * row's own table and its rules. One outbox entity for every kind, as on that screen.
 */
export function useObjectMoneyRowActions(objectId: string) {
  const qc = useQueryClient();
  const current = (id: string) =>
    qc.getQueryData<ObjectMoneyResponse>(objectMoneyKey(objectId))?.entries.find((e) => e.id === id) ?? null;
  const after = (kind: CashEntryKind) => () => {
    invalidateObjectMoney(qc, objectId);
    if (kind !== 'PERSONAL') void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  return {
    update: useMutation({
      networkMode: 'always',
      mutationFn: (vars: { id: string; req: CashEntryRequest }) => {
        const before = current(vars.id);
        return offlineMutate<void>({
          entity: 'cashEntry', entityId: vars.id, type: 'update', payload: { req: vars.req },
          online: async () => { await cashApi.update(vars.id, vars.req); },
          cancel: () => qc.cancelQueries({ queryKey: objectMoneyKey(objectId) }),
          onOnlineSuccess: after(vars.req.kind ?? 'PERSONAL'),
          optimistic: () => {
            if (!before) return;
            patch(qc, objectId, {
              removed: before,
              added: {
                ...before, amount: vars.req.amount, note: vars.req.note ?? null,
                happenedOn: vars.req.happenedOn ?? before.happenedOn,
                category: vars.req.category ?? before.category,
                materialRefund: vars.req.materialRefund,
                clientMaterial: before.kind === 'OBJECT_PAYMENT'
                  ? vars.req.materialRefund : before.clientMaterial,
              },
            });
          },
        });
      },
    }),
    remove: useMutation({
      networkMode: 'always',
      mutationFn: (vars: { id: string; kind: CashEntryKind }) => {
        const before = current(vars.id);
        return offlineMutate<void>({
          entity: 'cashEntry', entityId: vars.id, type: 'delete', payload: { kind: vars.kind },
          online: async () => { await cashApi.remove(vars.id, vars.kind); },
          cancel: () => qc.cancelQueries({ queryKey: objectMoneyKey(objectId) }),
          onOnlineSuccess: after(vars.kind),
          optimistic: () => {
            if (before) patch(qc, objectId, { removed: before });
          },
        });
      },
    }),
  };
}
