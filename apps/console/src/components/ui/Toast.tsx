"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

type Push = (message: string) => void;
const ToastContext = createContext<Push>(() => undefined);

/** Brief confirmations for LOCAL actions only (reset, download, copy). Never used to imply data was saved. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);
  const push = useCallback<Push>((message) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur.slice(-2), { id, message }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <Icon name="checkCircle" size={18} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
