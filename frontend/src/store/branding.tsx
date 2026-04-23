/**
 * Global site-branding context.
 *
 * The branding trio (site name / logo URL / footer copyright) is fetched
 * **once** on app boot from the public ``GET /api/branding`` endpoint, and
 * exposed via a React context so any component (header, footer, title) can
 * read the current values.
 *
 * A helper hook ``usePageTitle`` wires the document title to
 * ``"<current view> :: <site name>"`` and updates it on every mount /
 * dependency change — see AppLayout / Home / admin pages for usage.
 */

import axios from 'axios';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface BrandingInfo {
  site_name: string;
  logo_url: string;
  copyright: string;
  icp_filing: string;
  mps_filing: string;
  moeicp_filing: string;
}

interface BrandingContextValue extends BrandingInfo {
  /** Re-fetch branding from the backend (called after admin edits). */
  refresh: () => Promise<void>;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

// Conservative fallback used only on initial paint / network errors so the
// header never flashes "undefined".
const FALLBACK: BrandingInfo = {
  site_name: 'SRS Live Center',
  logo_url: '',
  copyright: '© SRS Live Center. All rights reserved.',
  icp_filing: '',
  mps_filing: '',
  moeicp_filing: '',
};

const BrandingContext = createContext<BrandingContextValue>({
  ...FALLBACK,
  refresh: async () => {},
  loading: false,
});

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [info, setInfo] = useState<BrandingInfo>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    try {
      const { data } = await axios.get<BrandingInfo>('/api/branding');
      setInfo(data);
    } catch (err) {
      // Branding is best-effort; if the backend is unreachable we keep the
      // in-process fallback rather than blocking the whole UI.
      console.warn('Failed to load site branding:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const value = useMemo<BrandingContextValue>(
    () => ({ ...info, refresh: fetchOnce, loading }),
    [info, fetchOnce, loading],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}


/**
 * Set ``document.title`` to ``"<page> :: <site name>"`` for the lifetime of
 * the calling component. Pass an empty / falsy ``page`` to show just the
 * site name on its own (e.g. landing page).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageTitle(page: string | undefined | null): void {

  const { site_name } = useBranding();
  useEffect(() => {
    const name = site_name || FALLBACK.site_name;
    document.title = page ? `${page} :: ${name}` : name;
  }, [page, site_name]);
}
