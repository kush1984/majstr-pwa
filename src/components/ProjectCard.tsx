import { useNavigate } from 'react-router-dom';
import { Badge } from './Badge.tsx';
import { IconTile } from './IconTile.tsx';
import { formatMoney } from '@/lib/format.ts';
import { ESTIMATE_STATUS, PROJECT_STATUS } from '@/lib/labels.ts';
import { routes } from '@/lib/config.ts';
import type { ProjectResponse } from '@/api/types.ts';

/**
 * Project (site) list card. Sum + badge come from the backend's
 * latestEstimateTotal / estimateStatus; when there's no estimate yet we fall
 * back to the project's own status and show no sum.
 */
export function ProjectCard({ project }: { project: ProjectResponse }) {
  const navigate = useNavigate();
  const badge = project.estimateStatus
    ? ESTIMATE_STATUS[project.estimateStatus]
    : PROJECT_STATUS[project.status];

  return (
    <button
      type="button"
      onClick={() => navigate(routes.project(project.id))}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3.5 text-left transition-transform active:scale-[0.99]"
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
  );
}
