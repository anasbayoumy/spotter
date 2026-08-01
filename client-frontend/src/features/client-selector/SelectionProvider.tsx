import type { PropsWithChildren, ReactElement } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  clearSelectedClientId,
  readSelectedClientId,
  storeSelectedClientId,
} from "../../lib/storage/selection";

interface SelectionContextValue {
  readonly clearSelection: () => Promise<void>;
  readonly clientId: string | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly selectClient: (clientId: string) => Promise<void>;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: PropsWithChildren): ReactElement {
  const [clientId, setClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readSelectedClientId()
      .then((storedClientId) => {
        if (active) setClientId(storedClientId);
      })
      .catch((storageError: unknown) => {
        if (active)
          setError(storageError instanceof Error ? storageError.message : "Selection unavailable.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectClient = useCallback(async (nextClientId: string): Promise<void> => {
    setError(null);
    await storeSelectedClientId(nextClientId);
    setClientId(nextClientId);
  }, []);
  const clearSelection = useCallback(async (): Promise<void> => {
    setError(null);
    await clearSelectedClientId();
    setClientId(null);
  }, []);
  const value = useMemo(
    () => ({ clearSelection, clientId, error, loading, selectClient }),
    [clearSelection, clientId, error, loading, selectClient],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useClientSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (context === null) throw new Error("useClientSelection requires SelectionProvider.");
  return context;
}
