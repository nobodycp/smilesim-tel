'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error';
type Item = { id: number; text: string; tone: Tone };

const ToastContext = createContext<{ push: (text: string, tone: Tone) => void } | null>(null);

export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('toasts');
  return context;
}

export function Toasts({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const push = useCallback((text: string, tone: Tone) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => dismiss(id), 4600);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-host">
        {items.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
            <p>{item.text}</p>
            <button type="button" onClick={() => dismiss(item.id)} aria-label="×">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
