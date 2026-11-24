/**
 * Generic data hook: fetch + CRUD helpers with automatic refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../api/client';

export function useApiData<T = any>(path: string | null, params?: Record<string, string | number | boolean | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    mounted.current = true;
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    request<T>(path, { params })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e.message || 'Failed to load data');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [path, version, JSON.stringify(params || {})]);

  return { data, loading, error, refresh, refetch: refresh, setData };
}

/**
 * Convenience hook for a CRUD resource: wraps an API path with
 * create/update/delete that refresh automatically.
 */
export function useCrudResource<T = any>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
) {
  const { data, loading, error, refresh } = useApiData<T[]>(path, params);

  const create = useCallback(
    async (body: Record<string, unknown>) => {
      const created = await request<T>(path, { method: 'POST', body });
      refresh();
      return created;
    },
    [path, refresh]
  );

  const update = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const updated = await request<T>(`${path}/${id}`, { method: 'PUT', body });
      refresh();
      return updated;
    },
    [path, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await request(`${path}/${id}`, { method: 'DELETE' });
      refresh();
    },
    [path, refresh]
  );

  return { data, loading, error, refresh, create, update, remove };
}

export default useApiData;