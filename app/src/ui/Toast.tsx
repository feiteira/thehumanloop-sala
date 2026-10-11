import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { focusOrigin, returnFocus } from './focusReturn';
import { Icon } from './Icon';
import { useI18n } from './i18n';
import { focusRing, web } from './primitives';
import { radius, space, type as typo, useTheme } from './theme';
import { watchUndoKey } from './undoKey';

// One short message at a time at the bottom centre of the window, usually with Undo: "Page
// deleted · Undo". A new message replaces the one showing. Screen readers hear it through a
// polite live region; the action and the close button are in the Tab order, and the timer
// pauses while the pointer or the keyboard focus is on the toast. Closing it from the keyboard
// sends the focus back to where it was before it came to the toast. Kept clear of the BETA
// ribbon's bottom-left corner (shell/BetaRibbon.tsx).

export interface ToastOptions {
  message: string;
  /** A button on the toast, usually Undo. */
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  /** How long it shows, paused while hovered or focused. Default 8 seconds. */
  durationMs?: number;
}

export interface Toasts {
  show: (toast: ToastOptions) => void;
  /** `message` with an Undo button; Ctrl+Z (⌘+Z) outside text fields presses it too. */
  undo: (message: string, onUndo: () => void | Promise<unknown>) => void;
  hide: () => void;
}

interface Current extends ToastOptions {
  id: number;
  undoKey: boolean;
}

const ToastContext = createContext<Toasts | null>(null);
let seq = 0;

/** For screens and the shell, inside the open practice (App.tsx mounts the provider). */
export function useToast(): Toasts {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

/** Mounted once around the open practice, so locking clears any toast with it. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toast, setToast] = useState<Current | null>(null);
  const api = useMemo<Toasts>(
    () => ({
      show: (o) => setToast({ ...o, id: ++seq, undoKey: false }),
      undo: (message, onUndo) => setToast({ message, actionLabel: t('common.undo'), onAction: onUndo, id: ++seq, undoKey: true }),
      hide: () => setToast(null),
    }),
    [t],
  );
  const dismiss = useCallback((id: number) => setToast((cur) => (cur?.id === id ? null : cur)), []);
  const failed = useCallback(() => setToast({ message: t('errors.generic'), id: ++seq, undoKey: false }), [t]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={toast} dismiss={dismiss} failed={failed} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, dismiss, failed }: { toast: Current | null; dismiss: (id: number) => void; failed: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const id = toast?.id;
  const box = useRef<View>(null);
  const origin = useRef<unknown>(null);

  // A toast removed under the pointer or the focus never hears it leave.
  useEffect(() => {
    setHovered(false);
    setFocused(false);
    origin.current = null;
  }, [id]);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs ?? 8000);
    return () => clearTimeout(timer);
  }, [toast, paused, dismiss]);

  const close = useCallback(() => {
    if (!toast) return;
    returnFocus(box.current, origin.current);
    dismiss(toast.id);
  }, [toast, dismiss]);

  const act = useCallback(() => {
    if (!toast?.onAction) return;
    close();
    Promise.resolve()
      .then(toast.onAction)
      .catch((e: unknown) => {
        console.error(e);
        failed();
      });
  }, [toast, close, failed]);

  useEffect(() => (toast?.undoKey ? watchUndoKey(act) : undefined), [toast, act]);

  const focusProps = {
    onFocus: (e: unknown) => {
      origin.current = focusOrigin(e, box.current, origin.current);
      setFocused(true);
    },
    onBlur: () => setFocused(false),
  };
  return (
    <View aria-live="polite" style={{ position: 'absolute', left: 72, right: 72, bottom: space.xl, alignItems: 'center', pointerEvents: 'box-none', zIndex: 20 }}>
      {toast ? (
        <View
          key={toast.id}
          ref={box}
          testID="toast"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          style={[
            { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: 560, minHeight: 48, paddingLeft: space.lg, paddingRight: space.xs, paddingVertical: space.xs, borderRadius: radius.md, backgroundColor: c.ink },
            web({ boxShadow: `0 6px 24px ${c.shadow}` }),
          ]}
        >
          <Text style={[typo.body, { color: c.onInk, flexShrink: 1, paddingVertical: space.xs, marginRight: space.sm }]}>{toast.message}</Text>
          {toast.actionLabel && toast.onAction ? (
            <Pressable
              testID="toast-action"
              onPress={act}
              {...focusProps}
              accessibilityRole="button"
              accessibilityLabel={toast.actionLabel}
              {...(toast.undoKey ? ({ 'aria-keyshortcuts': 'Control+Z Meta+Z' } as object) : {})}
              style={(s) => [
                { paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.sm },
                (s as { focused?: boolean }).focused && focusRing(c.accent),
                web({ cursor: 'pointer' }),
              ]}
            >
              {(s) => (
                <Text style={[typo.body, { color: c.accent, fontWeight: '700' }, (s as { hovered?: boolean }).hovered && { textDecorationLine: 'underline' }]}>
                  {toast.actionLabel}
                </Text>
              )}
            </Pressable>
          ) : null}
          <Pressable
            testID="toast-close"
            onPress={close}
            {...focusProps}
            accessibilityRole="button"
            accessibilityLabel={t('common.closeMessage')}
            {...({ title: t('common.closeMessage') } as object)}
            style={(s) => [
              { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
              (s as { focused?: boolean }).focused && focusRing(c.accent),
              web({ cursor: 'pointer' }),
            ]}
          >
            <Icon name="close" size={18} color={c.onInk} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
