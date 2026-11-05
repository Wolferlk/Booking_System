import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** GET a mobile API path; refetches whenever the screen comes into focus. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
    if (!pathRef.current) return;
    if (mode === 'refresh') setRefreshing(true);
    try {
      const d = await api<T>(pathRef.current);
      setData(d); setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(data ? 'silent' : 'initial'); }, [load, path])); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, setData, error, loading, refreshing, reload: () => load('refresh'), silent: () => load('silent') };
}
