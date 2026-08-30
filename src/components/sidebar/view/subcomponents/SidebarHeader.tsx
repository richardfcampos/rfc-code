import { LayoutDashboard, PanelLeftClose } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';

import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '../../../../constants/branding';
import { IS_PLATFORM } from '../../../../constants/config';

import BrandGlyph from './BrandGlyph';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  onCollapseSidebar: () => void;
  t: TFunction;
};

export default function SidebarHeader({ isPWA, isMobile, onCollapseSidebar, t }: SidebarHeaderProps) {
  const navigate = useNavigate();
  const logo = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-ctl bg-primary">
        <BrandGlyph className="h-3.5 w-3.5 text-primary-foreground" />
      </div>
      <h1
        className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground"
        style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}
      >
        {t('app.title')}
      </h1>
    </div>
  );

  return (
    <div className="flex-shrink-0">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        style={isPWA && isMobile ? { paddingTop: '16px' } : undefined}
      >
        {IS_PLATFORM ? (
          <a
            href="https://cloudcli.ai/dashboard"
            className="flex min-w-0 items-center transition-opacity duration-150 ease-out hover:opacity-80"
            title={t('tooltips.viewEnvironments')}
          >
            {logo}
          </a>
        ) : (
          logo
        )}

        <div className="flex flex-shrink-0 items-center gap-1">
          <a
            href="/overview"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Overview"
            aria-label="Overview"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate('/overview');
            }}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
          </a>

          <button
            type="button"
            className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
            onClick={onCollapseSidebar}
            title={t('tooltips.hideSidebar')}
            aria-label={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="nav-divider" />
    </div>
  );
}
