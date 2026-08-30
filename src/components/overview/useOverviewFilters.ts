import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  parseOverviewFilterParam,
  serializeOverviewFilterParam,
  type OverviewFilterId,
} from './utils/overview-filter';

const FILTER_PARAM = 'f';

type UseOverviewFiltersResult = {
  /** Active filters; empty means "All". */
  active: Set<OverviewFilterId>;
  toggle: (filter: OverviewFilterId) => void;
  selectAll: () => void;
};

/**
 * Multi-select filter state for the overview page, kept in the URL
 * (`?f=run,attn`) so a filtered view survives reloads and can be shared.
 * Unknown values in the query are ignored; replace-navigation keeps chip
 * clicks out of the back button history.
 */
export function useOverviewFilters(): UseOverviewFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const active = useMemo(
    () => parseOverviewFilterParam(searchParams.get(FILTER_PARAM)),
    [searchParams],
  );

  const applyFilters = useCallback(
    (next: ReadonlySet<OverviewFilterId>) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next.size === 0) {
            params.delete(FILTER_PARAM);
          } else {
            params.set(FILTER_PARAM, serializeOverviewFilterParam(next));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggle = useCallback(
    (filter: OverviewFilterId) => {
      const next = new Set(active);
      if (next.has(filter)) {
        // Removing the last active filter falls back to "All" (empty set).
        next.delete(filter);
      } else {
        next.add(filter);
      }
      applyFilters(next);
    },
    [active, applyFilters],
  );

  const selectAll = useCallback(() => {
    applyFilters(new Set());
  }, [applyFilters]);

  return { active, toggle, selectAll };
}
