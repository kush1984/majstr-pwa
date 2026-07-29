import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from './Badge.tsx';
import { IconTile } from './IconTile.tsx';
import { formatMoney } from '@/lib/format.ts';
import { ESTIMATE_STATUS_VARIANT, PROJECT_STATUS_VARIANT } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { ProjectResponse } from '@/api/types.ts';
import { ChatLinkRowButton } from '@/features/messages/ChatLinkRowButton.tsx';

/**
 * Project (site) list card. Sum + badge come from the backend's
 * latestEstimateTotal / estimateStatus; when there's no estimate yet we fall
 * back to the project's own status and show no sum.
 */
export function ProjectCard({ project }: { project: ProjectResponse }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const badge = project.estimateStatus
    ? {
        label: t('status.estimate.' + project.estimateStatus),
        variant: ESTIMATE_STATUS_VARIANT[project.estimateStatus],
      }
    : {
        label: t('status.project.' + project.status),
        variant: PROJECT_STATUS_VARIANT[project.status],
      };

  return (
    // The menu is a SIBLING of the card button, not a child: a button inside a button is invalid and
    // the inner one's taps get swallowed. Overlaid on the right with `pr-11` keeping the badge column
    // clear of it, so the whole card stays tappable.
    <div className="relative">
      <button
        type="button"
        onClick={() => navigate(routes.project(project.id))}
        className="flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3.5 pr-11 text-left transition-transform active:scale-[0.99]"
      >
        <IconTile tone="brand">📁</IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-primary">{project.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <span className="truncate">{project.address}</span>
            {project.clientFullName && (
              <>
                <span className="h-[3px] w-[3px] flex-shrink-0 rounded-full bg-faint" />
                <span className="truncate">{project.clientFullName}</span>
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
