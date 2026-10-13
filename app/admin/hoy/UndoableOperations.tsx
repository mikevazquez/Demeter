"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

type Operation = {
  key: string;
  label: string;
  action: (data: FormData) => Promise<unknown>;
  data: FormData;
};
type Pending = { key: string; label: string; expiresAt: number };
const QueueContext = createContext<((operation: Operation) => void) | null>(null);

export function useUndoableOperations() {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("undoable_operations_provider_required");
  return queue;
}

export function UndoableOperationsProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [now, setNow] = useState(0);
  const [saving, startTransition] = useTransition();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useCallback((operation: Operation) => {
    if (timers.current.has(operation.key)) return;
    const createdAt = Date.now();
    setNow(createdAt);
    setPending((items) => [
      ...items,
      { key: operation.key, label: operation.label, expiresAt: createdAt + 5000 },
    ]);
    timers.current.set(
      operation.key,
      setTimeout(() => {
        timers.current.delete(operation.key);
        setPending((items) => items.filter((item) => item.key !== operation.key));
        startTransition(async () => {
          await operation.action(operation.data);
        });
      }, 5000),
    );
  }, []);
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);
  useEffect(() => {
    if (!pending.length) return;
    const clock = setInterval(() => setNow(Date.now()), 100);
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leaving);
    return () => {
      clearInterval(clock);
      window.removeEventListener("beforeunload", leaving);
    };
  }, [pending.length]);
  return (
    <QueueContext.Provider value={queue}>
      {children}
      <div className="flow-undo-stack" aria-label="Operaciones pendientes">
        {pending.map((item) => (
          <div className="flow-undo-toast" key={item.key}>
            <span role="status">
              {item.label}
              <small>Pendiente de guardar</small>
            </span>
            <span aria-hidden="true">
              {Math.max(0, Math.ceil((item.expiresAt - now) / 1000))} s
            </span>
            <button
              type="button"
              aria-label={`Deshacer ${item.label.toLowerCase()}`}
              onClick={() => {
                const timer = timers.current.get(item.key);
                if (!timer) return;
                clearTimeout(timer);
                timers.current.delete(item.key);
                setPending((items) => items.filter((job) => job.key !== item.key));
              }}
            >
              Deshacer
            </button>
          </div>
        ))}
        {saving ? (
          <div className="flow-undo-toast" role="status">
            Guardando operación…
          </div>
        ) : null}
      </div>
    </QueueContext.Provider>
  );
}
