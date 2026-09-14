import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

/**
 * Runs an async loader and tracks { data, loading, error }.
 *
 * The two things that make this worth having over a raw useEffect: it ignores
 * results from a request that has been superseded (so fast typing in a search
 * box cannot show stale rows), and it never sets state after unmount.
 */
export function useAsync(loader, deps = [], { immediate = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);

  const mounted = useRef(true);
  const runId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await loaderRef.current(...args);
      // A newer call started while this one was in flight - drop this result.
      if (!mounted.current || id !== runId.current) return undefined;
      setData(result);
      return result;
    } catch (err) {
      if (!mounted.current || id !== runId.current) return undefined;
      setError(err);
      return undefined;
    } finally {
      if (mounted.current && id === runId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, run, setData, reload: run };
}

/**
 * A one-shot action (save, delete, publish) with its own pending flag and
 * automatic error toast, so every button does not re-implement try/catch.
 */
export function useAction() {
  const { toastError } = useApp();
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const perform = useCallback(
    async (fn, { onError, silent = false } = {}) => {
      setPending(true);
      try {
        return await fn();
      } catch (err) {
        if (!silent) toastError(err);
        if (onError) onError(err);
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [toastError],
  );

  return { pending, perform };
}

/** Delays a rapidly-changing value - used for search inputs. */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
