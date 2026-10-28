"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "error";
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<
  ((message: string, tone?: Tone) => void) | null
>(null);

/**
 * Short messages at the bottom of the screen ("Role updated"). They go away
 * after 5 seconds and are announced to screen readers.
 *
 * Wrap a page in <ToastProvider>, then: const toast = useToast(); toast("Saved").
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Tone = "neutral") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-32px)] flex-col items-end gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid="toast"
            className={cn(
              "pointer-events-auto rounded-sm px-4 py-2.5 text-sm shadow-md",
              t.tone === "error" ? "bg-red text-white" : "bg-ink text-white",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <ToastProvider> around it");
  return show;
}
