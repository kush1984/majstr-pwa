import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Введіть email')
    .email('Невірний формат email'),
  password: z.string().min(1, 'Введіть пароль'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
