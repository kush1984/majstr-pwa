import { Button } from '@/components/Button.tsx';
import { usePush } from '@/hooks/usePush.ts';
import { toast } from '@/hooks/useToast.ts';

/**
 * The push button on the dashboard. We deliberately don't auto-prompt
 * for notification permission on first visit — Chrome / Firefox punish
 * sites that do that with "block this permission" UI.
 */
export function EnablePushButton() {
  const { permission, isSubscribed, isReady, enable, disable } = usePush();

  if (!isReady) return null;

  if (permission === 'unsupported') {
    return (
      <p className="text-sm text-gray-500">
        Браузер не підтримує push-сповіщення. На iOS — встановіть PWA на головний екран.
      </p>
    );
  }

  if (isSubscribed) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-green-700">✓ Сповіщення увімкнено</p>
        <Button variant="ghost" onClick={() => void disable()}>
          Вимкнути сповіщення
        </Button>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <p className="text-sm text-gray-500">
        Сповіщення заблоковано в налаштуваннях браузера. Розблокуйте та оновіть сторінку.
      </p>
    );
  }

  return (
    <Button
      variant="secondary"
      onClick={async () => {
        const r = await enable();
        if (r.ok) {
          toast.success('Сповіщення увімкнено');
        } else if (r.error) {
          toast.error(r.error);
        }
      }}
    >
      Увімкнути сповіщення
    </Button>
  );
}
