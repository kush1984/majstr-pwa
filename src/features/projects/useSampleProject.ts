import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '@/api/projects.ts';
import { toAppError } from '@/api/errors.ts';
import { toast } from '@/hooks/useToast.ts';
import { useOnlineGuard } from '@/hooks/useOnlineGuard.ts';
import { routes } from '@/lib/config.ts';
import type { Trade } from '@/api/types.ts';
import { PROJECTS_KEY } from './useProjects.ts';

/**
 * «Подивитися приклад» (V197): the server makes an object with a priced estimate for the master's
 * trade, and the app opens it. ONLINE only — the sample is filled on the server, there is nothing to
 * queue — so offline the tap says a connection is needed (`useOnlineGuard`) instead of failing.
 * A second tap while one is alive (another phone made it) goes to the objects list, where it is.
 */
export function useSampleProject() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { online, guard, offlineTitle } = useOnlineGuard();
  const [creating, setCreating] = useState(false);

  const create = async (trade?: Trade, before?: () => Promise<void>) => {
    if (creating) return;
    setCreating(true);
    try {
      await before?.();
      const sample = await projectsApi.createSample(trade);
      await qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      void navigate(routes.project(sample.id), { replace: true });
    } catch (err) {
      const e = toAppError(err);
      if (e.code === 'SAMPLE_PROJECT_EXISTS') {
        toast.info(t('sample.exists'));
        void navigate(routes.projects, { replace: true });
      } else {
        toast.error(e.message);
      }
    } finally {
      setCreating(false);
    }
  };

  return {
    /** Wrapped in the online guard: offline it explains instead of trying. */
    open: (trade?: Trade, before?: () => Promise<void>) => guard(() => create(trade, before))(),
    creating,
    online,
    offlineTitle,
  };
}
