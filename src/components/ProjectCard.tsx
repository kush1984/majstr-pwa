import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from './Badge.tsx';
import { IconTile } from './IconTile.tsx';
import { formatMoney } from '@/lib/format.ts';
import { OBJECT_STAGE_VARIANT } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { ChatLinkRowButton } from '@/features/messages/ChatLinkRowButton.tsx';

/**
 * Project (site) list card. The badge shows the object's derived {@link ObjectStage}
 * (object-status-unification) — the ONE status vocabulary, everywhere. It used to switch between
 * the latest estimate's own status and the object's raw status depending on whether an estimate
 * existed yet — two different vocabularies in the same badge slot, which is what let the
 * dashboard's "Очікує" metric and this card's own filter chip disagree on the same object.
 */
export function ProjectCard({ project }: { project: ProjectResponse }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const badge = {
    label: t('status.stage.' + project.stage),
    variant: OBJECT_STAGE_VARIANT[project.stage],
  };

  return (
    // The menu is a SIBLING of the card button, not a child: a button inside a button is invalid and
    // the inner one's taps get swallowed. Overlaid on the right with `pr-11` keeping the badge column
    // clear of it, so the whole card stays tappable.
    <div className="relative">
      <button
        type="button"
        onClick={() => navigate(routes.project(project.id))}
        className="flex w-full items-start gap-3 rounded-card border border-border bg-surface p-3.5 pr-11 text-left transition-transform active:scale-[0.99]"
      >
        <IconTile tone="brand">📁</IconTile>
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncates. A master names objects by street or by client, so what
              tells «Квартира на Зубрівській» from «Квартира на Зеленій» sits at the END — precisely
              what an ellipsis eats first on a 375 px screen. The address line wraps for the same
              reason: cut to «вул. С. Б…» it identifies nothing. */}
          <div className="break-words text-sm font-semibold leading-snug text-primary">
            {project.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className="break-words">{project.address}</span>
            {project.clientFullName && (
              <>
                <span className="h-[3px] w-[3px] flex-shrink-0 rounded-full bg-faint" />
                <span className="break-words">{project.clientFullName}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {project.unreadQuestions > 0 && (
            <span className="whitespace-nowrap rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
              💬 {project.unreadQuestions}
            </span>
          )}
          {project.latestEstimateTotal != null && (
            <span className="whitespace-nowrap text-sm font-bold text-primary">
              {formatMoney(project.latestEstimateTotal)}
            </span>
          )}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <ChatLinkRowButton projectId={project.id} projectName={project.name} />
      </div>
    </div>
  );
}
