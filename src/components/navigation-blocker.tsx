"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

type NavigationBlocker = {
  isBlocked: boolean;
  setIsBlocked: (blocked: boolean) => void;
  setDiscardHandler: (handler: (() => void) | null) => void;
  confirmLeave: () => boolean;
};

const NavigationBlockerContext = createContext<NavigationBlocker>({
  isBlocked: false,
  setIsBlocked: () => undefined,
  setDiscardHandler: () => undefined,
  confirmLeave: () => true,
});

export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const [isBlocked, setIsBlocked] = useState(false);
  const discardHandler = useRef<(() => void) | null>(null);

  const setDiscardHandler = useCallback((handler: (() => void) | null) => {
    discardHandler.current = handler;
  }, []);

  const confirmLeave = useCallback(() => {
    if (!isBlocked) return true;
    if (!window.confirm("未保存の支払い方法名があります。変更を破棄して移動しますか？")) return false;
    discardHandler.current?.();
    setIsBlocked(false);
    return true;
  }, [isBlocked]);

  return (
    <NavigationBlockerContext.Provider value={{ isBlocked, setIsBlocked, setDiscardHandler, confirmLeave }}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker() {
  return useContext(NavigationBlockerContext);
}
