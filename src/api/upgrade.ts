import { api } from './client.ts';

/**
 * PRO upgrade-intent tracking (painted door). `click` is best-effort — it must
 * never surface an error to the master (the CTA still opens the modal). `interest`
 * records the warm lead and may report failure so the modal can react.
 */
export const upgradeApi = {
  click(trigger: string): Promise<void> {
    return api
      .post('/api/upgrade/click', { trigger })
      .then(() => undefined)
      .catch(() => undefined);
  },

  interest(reason?: string): Promise<void> {
    return api.post('/api/upgrade/interest', { reason }).then(() => undefined);
  },
};
