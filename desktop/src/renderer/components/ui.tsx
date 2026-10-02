import { X } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BRAND_ICONS, fallbackColor } from "../brand-icons";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  icon,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-primary-600 text-white hover:bg-primary-700 shadow-sm disabled:bg-primary-600/50",
    secondary: "bg-surface border border-border text-foreground hover:bg-elevated shadow-card",
    ghost: "text-foreground/80 hover:bg-elevated hover:text-foreground",
    danger: "bg-danger text-white hover:bg-danger/90 shadow-sm",
  };
  const sizes = { sm: "h-7 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 gap-2", lg: "h-11 px-5 text-[15px] gap-2" };
  return (
    <button
      type="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
        className,
      )}
      {...props}>
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
        checked ? "bg-primary-600" : "bg-border",
      )}>
      <span
        className={cx(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
}: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer rounded accent-[rgb(var(--primary-600))]"
    />
  );
}

/** Site mark: bundled brand logo, else the site's favicon, else a colored monogram. */
export function Favicon({
  src,
  label,
  siteKey,
  size = 20,
  className,
}: { src?: string; label: string; siteKey?: string; size?: number; className?: string }) {
  const brand = siteKey ? BRAND_ICONS[siteKey] : undefined;
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  const box = { width: size, height: size };

  if (brand) {
    // Black/near-black marks (X, Threads, TikTok, Medium…) use the foreground color so they work in dark mode.
    const dark =
      Number.parseInt(brand.hex.slice(0, 2), 16) +
        Number.parseInt(brand.hex.slice(2, 4), 16) +
        Number.parseInt(brand.hex.slice(4, 6), 16) <
      90;
    return (
      <span
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-md",
          dark && "bg-foreground",
          className,
        )}
        style={{ ...box, background: dark ? undefined : `#${brand.hex}` }}
        aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width={size * 0.62}
          height={size * 0.62}
          className={dark ? "fill-background" : "fill-white"}>
          <title>{label}</title>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  if (failed) {
    const initial = label.trim().charAt(0).toUpperCase() || "?";
    return (
      <span
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white",
          className,
        )}
        style={{ ...box, fontSize: size * 0.48, background: fallbackColor(siteKey || label) }}
        aria-hidden="true">
        {initial}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      // Some sites answer with a 1×1 or empty image instead of an error.
      onLoad={(e) => (e.currentTarget.naturalWidth < 8 ? setFailed(true) : undefined)}
      className={cx("shrink-0 rounded-md bg-white object-contain", className)}
      style={box}
    />
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-pop"
        style={{ maxWidth: width }}>
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border bg-elevated/40 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {body && <p className="max-w-sm text-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted/80">{hint}</span>}
    </label>
  );
}

// ---- Toasts & confirm ---------------------------------------------------------------------------

interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface Feedback {
  toast: (text: string, kind?: Toast["kind"]) => void;
  confirm: (text: string, opts?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback>({ toast: () => {}, confirm: async () => false });

export function useFeedback() {
  return useContext(FeedbackContext);
}

export function FeedbackProvider({
  children,
  labels,
}: { children: ReactNode; labels: { cancel: string; confirm: string } }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<{
    text: string;
    danger?: boolean;
    confirmLabel?: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const counter = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++counter.current;
    setToasts((list) => [...list.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const confirm = useCallback(
    (text: string, opts?: { danger?: boolean; confirmLabel?: string }) =>
      new Promise<boolean>((resolve) => setPending({ text, ...opts, resolve })),
    [],
  );

  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] flex-col gap-2">
        {toasts.map((x) => (
          <div
            key={x.id}
            role="status"
            className={cx(
              "pointer-events-auto rounded-xl border px-4 py-3 shadow-pop",
              x.kind === "error" && "border-danger/30 bg-surface text-danger",
              x.kind === "success" && "border-success/30 bg-surface text-foreground",
              x.kind === "info" && "border-border bg-surface text-foreground",
            )}>
            {x.text}
          </div>
        ))}
      </div>
      <Modal
        open={!!pending}
        title={pending?.confirmLabel ?? labels.confirm}
        onClose={() => close(false)}
        width={420}
        footer={
          <>
            <Button onClick={() => close(false)}>{labels.cancel}</Button>
            <Button variant={pending?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {pending?.confirmLabel ?? labels.confirm}
            </Button>
          </>
        }>
        <p className="leading-relaxed">{pending?.text}</p>
      </Modal>
    </FeedbackContext.Provider>
  );
}
