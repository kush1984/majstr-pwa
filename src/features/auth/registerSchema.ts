import { z } from 'zod';

export const TRADE_OPTIONS = [
  { value: 'ELECTRICAL', label: 'Електрика' },
  { value: 'PLUMBING',   label: 'Сантехніка' },
  { value: 'TILING',     label: 'Плитка' },
  { value: 'GENERAL',    label: 'Загальні роботи' },
  { value: 'OTHER',      label: 'Інше' },
] as const;

const TRADE_VALUES = TRADE_OPTIONS.map((t) => t.value) as [string, ...string[]];

export const registerSchema = z.object({
  email: z
    .string()
    .min(1, 'Введіть email')
    .email('Невірний формат email')
    .max(255, 'Занадто довгий email'),
  password: z
    .string()
    .min(8, 'Пароль має бути не коротше 8 символів')
    .max(100, 'Пароль занадто довгий'),
  fullName: z
    .string()
    .min(1, 'Введіть ім\'я та прізвище')
    .max(255, 'Занадто довге значення'),
  trade: z.enum(TRADE_VALUES, { message: 'Оберіть тип робіт' }),
  phone: z
    .string()
    .min(5, 'Введіть телефон')
    .max(50, 'Занадто довге значення'),
  companyName: z
    .string()
    .min(1, 'Введіть назву компанії')
    .max(255, 'Занадто довге значення'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
