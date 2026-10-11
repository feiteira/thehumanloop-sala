import React, { forwardRef, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type NativeSyntheticEvent, type StyleProp, type TextInputContentSizeChangeEventData, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { focusBackTo, focusedElement } from './focusReturn';
import { focusVisible } from './focusVisible';
import { grownHeight } from './grow';
import { Icon } from './Icon';
import { useI18n } from './i18n';
import type { IconName } from './icons';
import { radius, space, type as typo, useTheme } from './theme';

/** Web-only style properties (cursor, outlines, transitions) that React Native's types omit. */
export const web = (s: Record<string, unknown>): ViewStyle => s as ViewStyle;

/** What the primitives read from a key event (react-native-web hands `onKeyDown` React's event). */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  nativeEvent?: { repeat?: boolean };
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** react-native-web only lets Space press buttons; checkboxes, radios and tabs handle it themselves. */
const isSpace = (e: KeyEventLike) => (e.key === ' ' || e.key === 'Spacebar') && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * ARIA state for a Pressable or View. react-native-web 0.21 ignores `accessibilityState`, and
 * React Native's types lack `aria-current`, so spread this instead:
 * `<Pressable {...ariaState({ current: active && 'page' })} …>`. There is no `disabled`: a
 * Pressable writes `aria-disabled` from its own `disabled` prop over anything spread on it.
 */
export function ariaState(s: {
  checked?: boolean | 'mixed';
  selected?: boolean;
  busy?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  current?: boolean | 'page' | 'step' | 'location' | 'date' | 'time';
}): object {
  const out: Record<string, unknown> = {};
  if (s.checked !== undefined) out['aria-checked'] = s.checked;
  if (s.selected !== undefined) out['aria-selected'] = s.selected;
  if (s.busy !== undefined) out['aria-busy'] = s.busy;
  if (s.expanded !== undefined) out['aria-expanded'] = s.expanded;
  if (s.pressed !== undefined) out['aria-pressed'] = s.pressed;
  if (s.current) out['aria-current'] = s.current === true ? 'true' : s.current;
  return out;
}

type Variant = keyof typeof typo;
type Tone = 'primary' | 'secondary' | 'muted' | 'danger' | 'accent' | 'success' | 'inverse';

export function T({
  variant = 'body', tone = 'primary', style, children, numberOfLines, selectable, role, nativeID,
}: {
  variant?: Variant;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  selectable?: boolean;
  role?: 'heading';
  /** Becomes the element's id, for aria-describedby. */
  nativeID?: string;
}) {
  const { c } = useTheme();
  const color = {
    primary: c.text, secondary: c.textSecondary, muted: c.textMuted, danger: c.dangerText,
    accent: c.accentText, success: c.successText, inverse: c.onPrimary,
  }[tone];
  return (
    <Text
      style={[typo[variant], { color }, style]}
      numberOfLines={numberOfLines}
      selectable={selectable}
      accessibilityRole={role === 'heading' ? 'header' : undefined}
      nativeID={nativeID}
    >
      {children}
    </Text>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, variant = 'secondary', icon, disabled, busy, small, style, testID, accessibilityLabel, accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** A fuller name for screen readers, when the visible label is the same on several buttons. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { c, scheme } = useTheme();
  const isDisabled = disabled || busy;
  const palette = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent, hover: scheme === 'dark' ? '#F6CE7B' : '#F4C65E', pressed: c.accentPressed },
    secondary: { bg: 'transparent', fg: c.text, border: c.border, hover: c.surfaceAlt, pressed: c.primarySubtle },
    ghost: { bg: 'transparent', fg: c.text, border: 'transparent', hover: c.surfaceAlt, pressed: c.primarySubtle },
    danger: { bg: c.dangerBg, fg: c.dangerText, border: c.dangerBorder, hover: c.dangerBg, pressed: c.dangerBorder },
  }[variant];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      aria-busy={!!busy}
      style={(state) => {
        const { pressed, hovered, focused } = state as { pressed: boolean; hovered?: boolean; focused?: boolean };
        return [
          styles.button,
          small && styles.buttonSmall,
          {
            backgroundColor: pressed ? palette.pressed : hovered ? palette.hover : palette.bg,
            borderColor: palette.border,
            opacity: isDisabled ? 0.5 : 1,
          },
          focused && focusRing(c.focus),
          web({ cursor: isDisabled ? 'default' : 'pointer', transitionDuration: '120ms' }),
          style,
        ];
      }}
    >
      {busy ? <ActivityIndicator size="small" color={palette.fg} /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={palette.fg} /> : null}
      <Text style={[small ? typo.small : typo.body, { color: palette.fg, fontWeight: '600' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon, label, onPress, tone = 'secondary', size = 36, disabled, testID, active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'secondary' | 'primary' | 'danger';
  size?: number;
  disabled?: boolean;
  testID?: string;
  active?: boolean;
}) {
  const { c } = useTheme();
  const color = tone === 'danger' ? c.dangerText : tone === 'primary' ? c.text : c.textSecondary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Tooltip on desktop.
      {...({ title: label } as object)}
      style={(state) => {
        const { pressed, hovered, focused } = state as { pressed: boolean; hovered?: boolean; focused?: boolean };
        return [
          { width: size, height: size, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
          { backgroundColor: pressed ? c.primarySubtle : hovered || active ? c.surfaceAlt : 'transparent', opacity: disabled ? 0.4 : 1 },
          focused && focusRing(c.focus),
          web({ cursor: disabled ? 'default' : 'pointer' }),
        ];
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} color={color} />
    </Pressable>
  );
}

export const focusRing = (color: string): ViewStyle =>
  focusVisible() ? web({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: color, outlineOffset: 2 }) : web({ outlineStyle: 'none' });

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Shown under the field and read with it (aria-describedby); an error takes its place. */
  hint?: string;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  multiline?: boolean;
  minHeight?: number;
  /** Multiline that grows with its text from `minHeight` (96) up to `maxHeight`, then scrolls. */
  autoGrow?: boolean;
  maxHeight?: number;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, style, inputStyle, multiline, minHeight, autoGrow, maxHeight, ...rest },
  ref,
) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const messageId = `${useId()}-message`;
  const multi = !!(multiline || autoGrow);
  const min = multi ? (minHeight ?? 96) : 40;
  // The browser reports the text's height as it grows; it never reports shrinking while the
  // box is taller than its text, so an emptied field starts again from the minimum.
  const [grown, setGrown] = useState<number | null>(null);
  // One handler for the field's life: react-native-web measures the box again whenever it changes.
  const userSizeChange = rest.onContentSizeChange;
  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      if (autoGrow) setGrown((cur) => grownHeight(cur, e.nativeEvent.contentSize.height, min, maxHeight));
      userSizeChange?.(e);
    },
    [autoGrow, min, maxHeight, userSizeChange],
  );
  const described = !!(error || hint);
  return (
    <View style={style}>
      {label ? <T variant="label" tone="secondary" style={{ marginBottom: space.xs }}>{label}</T> : null}
      <TextInput
        ref={ref}
        {...rest}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        {...({ 'aria-invalid': error ? true : undefined, 'aria-describedby': described ? messageId : undefined } as object)}
        multiline={multi}
        onChangeText={(text) => {
          if (autoGrow && !text) setGrown(null);
          rest.onChangeText?.(text);
        }}
        onContentSizeChange={autoGrow || userSizeChange ? onContentSizeChange : undefined}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={c.textMuted}
        style={[
          typo.body,
          styles.input,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: error ? c.dangerBorder : focused ? c.accent : c.border,
            minHeight: min,
          },
          multi && { textAlignVertical: 'top', paddingTop: 10 },
          autoGrow && { height: grown ?? min, maxHeight },
          web({ outlineStyle: 'none' }),
          focused && web({ boxShadow: `0 0 0 2px ${c.focus}` }),
          inputStyle,
        ]}
      />
      {hint && !error ? (
        <T variant="small" tone="muted" nativeID={messageId} style={{ marginTop: space.xs }}>
          {hint}
        </T>
      ) : null}
      {/* Errors only in a live region, so one that appears on blur is heard as well as seen;
          a hint that changes with the text (a character count) would be read at every key. */}
      <View aria-live="polite">
        {error ? (
          <T variant="small" tone="danger" nativeID={messageId} style={{ marginTop: space.xs }}>
            {error}
          </T>
        ) : null}
      </View>
    </View>
  );
});

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.lg }, padded && { padding: space.lg }, style]}>
      {children}
    </View>
  );
}

export function Row({ children, gap = space.sm, style, wrap, align = 'center' }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; wrap?: boolean; align?: ViewStyle['alignItems'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Col({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[{ height: 1, backgroundColor: c.divider, alignSelf: 'stretch' }, style]} />;
}

export function Badge({ label, tone = 'info' }: { label: string; tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }) {
  const { c } = useTheme();
  const colors = {
    info: [c.infoBg, c.infoText], success: [c.successBg, c.successText], warning: [c.warningBg, c.warningText],
    danger: [c.dangerBg, c.dangerText], neutral: [c.surfaceAlt, c.textSecondary],
  }[tone];
  return (
    <View style={{ backgroundColor: colors[0], borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={[typo.tiny, { color: colors[1], fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

export interface ChoiceItemProps {
  ref: (node: View | null) => void;
  onPress: () => void;
  accessibilityRole: 'radio' | 'tab';
  tabIndex: 0 | -1;
  'aria-checked'?: boolean;
  'aria-selected'?: boolean;
  onKeyDown: (e: KeyEventLike) => void;
}

/**
 * Keyboard use for a radio group or a tab list: one Tab stop (the chosen option), arrow keys
 * and Home/End move to another option and choose it, Space or Enter chooses the focused one.
 * The container carries the group role and label; spread `item(value)` onto each option.
 */
export function useChoiceGroup<V>({
  values, value, onChange, role = 'radio',
}: {
  values: readonly V[];
  value: V | null | undefined;
  onChange: (v: V) => void;
  role?: 'radio' | 'tab';
}): { item: (v: V) => ChoiceItemProps } {
  const nodes = useRef(new Map<V, View>());
  const tabStop = value !== undefined && value !== null && values.includes(value) ? value : values[0];
  const item = (v: V): ChoiceItemProps => ({
    ref: (node) => {
      if (node) nodes.current.set(v, node);
      else nodes.current.delete(v);
    },
    onPress: () => onChange(v),
    accessibilityRole: role,
    ...(role === 'tab' ? { 'aria-selected': v === value } : { 'aria-checked': v === value }),
    tabIndex: v === tabStop ? 0 : -1,
    onKeyDown: (e) => {
      if (isSpace(e)) {
        e.preventDefault();
        if (!e.nativeEvent?.repeat) onChange(v);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = values.indexOf(v);
      const n = values.length;
      let j: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          j = (i + 1) % n;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          j = (i - 1 + n) % n;
          break;
        case 'Home':
          j = 0;
          break;
        case 'End':
          j = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const next = values[j]!;
      onChange(next);
      nodes.current.get(next)?.focus();
    },
  });
  return { item };
}

export function Segmented<V extends string>({
  value, options, onChange, label,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  const { c } = useTheme();
  const group = useChoiceGroup({ values: options.map((o) => o.value), value, onChange });
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            {...group.item(o.value)}
            accessibilityLabel={o.label}
            style={(state) => [
              styles.segment,
              { backgroundColor: selected ? c.surface : 'transparent' },
              selected && { borderColor: c.border, borderWidth: 1 },
              (state as { focused?: boolean }).focused && focusRing(c.focus),
              web({ cursor: 'pointer' }),
            ]}
          >
            <Text style={[typo.small, { color: selected ? c.text : c.textSecondary, fontWeight: selected ? '600' : '500' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ checked, onChange, label, hint, hideLabel, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; hideLabel?: boolean; testID?: string }) {
  const { c } = useTheme();
  const hintId = `${useId()}-hint`;
  const showHint = !!hint && !hideLabel;
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      testID={testID}
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      {...({
        'aria-describedby': showHint ? hintId : undefined,
        onKeyDown: (e: KeyEventLike) => {
          if (!isSpace(e)) return;
          e.preventDefault();
          if (!e.nativeEvent?.repeat) onChange(!checked);
        },
      } as object)}
      style={(state) => [{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', borderRadius: radius.sm }, (state as { focused?: boolean }).focused && focusRing(c.focus), web({ cursor: 'pointer' })]}
    >
      <View style={[styles.checkbox, { borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : c.surface }]}>
        {checked ? <Icon name="check" size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
      {hideLabel ? null : (
        <View style={{ flex: 1, gap: 2 }}>
          <T>{label}</T>
          {showHint ? <T variant="small" tone="muted" nativeID={hintId}>{hint}</T> : null}
        </View>
      )}
    </Pressable>
  );
}

export function Notice({ tone = 'info', title, children, icon, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; icon?: IconName; action?: ReactNode }) {
  const { c } = useTheme();
  const [bg, fg] = { info: [c.infoBg, c.infoText], warning: [c.warningBg, c.warningText], danger: [c.dangerBg, c.dangerText], success: [c.successBg, c.successText] }[tone];
  return (
    <View accessibilityRole={tone === 'danger' ? 'alert' : undefined} style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Icon name={icon ?? (tone === 'success' ? 'check' : tone === 'info' ? 'help' : 'alert')} size={18} color={fg!} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[typo.label, { color: fg }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Text style={[typo.small, { color: fg }]}>{children}</Text> : children}
      </View>
      {action}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.md }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={28} color={c.textSecondary} />
      </View>
      <T variant="heading" style={{ textAlign: 'center' }}>{title}</T>
      {body ? <T tone="secondary" style={{ textAlign: 'center', maxWidth: 420 }}>{body}</T> : null}
      {action}
    </View>
  );
}

// Open dialogs, innermost last, so Ctrl+Enter submits only the one on top.
const openDialogs: number[] = [];
let dialogSeq = 0;

export function Dialog({
  visible, title, onClose, children, footer, width = 520, testID, onSubmit, onShow,
}: {
  visible: boolean;
  title: string;
  /** Close button and Escape. */
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  testID?: string;
  /** Ctrl+Enter (⌘+Enter on a Mac), from anywhere in the dialog: the footer's main action. Leave it out while that action is unavailable. */
  onSubmit?: () => void;
  /**
   * Once the dialog is up and holds the focus trap. A dialog opened from another one can only
   * take the focus then (a field's autoFocus is lost to the dialog underneath), so it focuses
   * its field here.
   */
  onShow?: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [id] = useState(() => ++dialogSeq);
  const submit = useRef(onSubmit);
  submit.current = onSubmit;
  // The control that opened the dialog, noted as it opens (before a field inside takes the
  // focus), so closing hands the focus back there instead of to the top of the window.
  // react-native-web's own return goes to what had the focus once the dialog was up: a field
  // inside it, gone by then.
  const opener = useRef<unknown>(null);
  const wasVisible = useRef(false);
  // A dialog opened from another one appears at once, without the fade: react-native-web moves
  // the focus trap and Escape to a dialog only once it is shown, and until then a key meant for
  // this one (Escape, Enter, typing) would act on the dialog underneath.
  const stacked = useRef(false);
  if (visible && !wasVisible.current) {
    opener.current = focusedElement();
    stacked.current = openDialogs.length > 0;
  }
  wasVisible.current = visible;
  useEffect(() => {
    if (!visible) return;
    openDialogs.push(id);
    return () => {
      const i = openDialogs.indexOf(id);
      if (i >= 0) openDialogs.splice(i, 1);
      const to = opener.current;
      opener.current = null;
      setTimeout(() => focusBackTo(to), 0);
    };
  }, [visible, id]);
  if (!visible) return null;
  // Escape and the close button act only on the dialog on top, never on one underneath it.
  const closeIfOnTop = () => {
    if (openDialogs[openDialogs.length - 1] === id) onClose();
  };
  // Capture phase, so Ctrl+Enter belongs to the dialog alone. Stopping it here keeps it from
  // a text field (which stops keys from bubbling, and would take Enter as its own submit or a
  // new line) and from the focused control, which react-native-web presses on any Enter
  // whatever the modifiers: a checkbox would toggle after the submit. A held key submits once.
  const onKeyDownCapture = (e: KeyEventLike) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || openDialogs[openDialogs.length - 1] !== id) return;
    e.preventDefault();
    e.stopPropagation();
    if (submit.current && !e.nativeEvent?.repeat) submit.current();
  };
  return (
    <Modal transparent visible animationType={stacked.current ? 'none' : 'fade'} onRequestClose={closeIfOnTop} onShow={onShow ? () => setTimeout(onShow, 0) : undefined}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl }]}>
        <View
          testID={testID}
          role="dialog"
          accessibilityLabel={title}
          {...({ 'aria-modal': true, onKeyDownCapture } as object)}
          style={[{ backgroundColor: c.surface, borderRadius: radius.lg, width, maxWidth: '100%', maxHeight: '92%', borderWidth: 1, borderColor: c.border }, web({ boxShadow: `0 8px 32px ${c.shadow}` })]}
        >
          <Row style={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm }}>
            <T variant="heading" role="heading" style={{ flex: 1 }}>{title}</T>
            <IconButton icon="close" label={t('common.close')} onPress={closeIfOnTop} />
          </Row>
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }}>{children}</ScrollView>
          {footer ? (
            <Row wrap style={{ justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: c.divider }}>{footer}</Row>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export interface ConfirmChoice {
  label: string;
  onPress: () => void | Promise<unknown>;
  /** Styled as a destructive action. */
  danger?: boolean;
  icon?: IconName;
  testID?: string;
}

/**
 * Asks before an action, above all a destructive one. The action may be async: its button
 * shows progress, the dialog closes itself when the action succeeds (through `onClose`) and
 * stays open with a message when it fails. `secondary` adds a middle choice, such as Archive
 * next to Delete, or a gentler main choice with the destructive one beside it.
 */
export function ConfirmDialog({
  visible, title, message, children, confirmLabel, onConfirm, onClose, danger, confirmIcon, secondary, cancelLabel, width = 440, testID,
}: {
  visible: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
  /** Cancel, Escape and the close button; also called after a choice succeeds. */
  onClose: () => void;
  /** The confirm button is destructive (and Ctrl+Enter does not press it). */
  danger?: boolean;
  confirmIcon?: IconName;
  secondary?: ConfirmChoice;
  cancelLabel?: string;
  width?: number;
  testID?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'confirm' | 'secondary' | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setBusy(null);
    setFailed(false);
  }, [visible]);
  const run = async (which: 'confirm' | 'secondary', action: () => void | Promise<unknown>) => {
    if (busy) return;
    setBusy(which);
    setFailed(false);
    try {
      await action();
      setBusy(null);
      onClose();
    } catch (e) {
      console.error(e);
      setBusy(null);
      setFailed(true);
    }
  };
  const confirm = () => void run('confirm', onConfirm);
  return (
    <Dialog
      visible={visible}
      title={title}
      onClose={busy ? () => undefined : onClose}
      onSubmit={danger || busy ? undefined : confirm}
      width={width}
      testID={testID}
      footer={
        <>
          <Button label={cancelLabel ?? t('common.cancel')} onPress={onClose} disabled={!!busy} testID={testID ? `${testID}-cancel` : undefined} />
          {secondary ? (
            <Button
              label={secondary.label}
              icon={secondary.icon}
              variant={secondary.danger ? 'danger' : 'secondary'}
              busy={busy === 'secondary'}
              disabled={!!busy}
              onPress={() => void run('secondary', secondary.onPress)}
              testID={secondary.testID}
            />
          ) : null}
          <Button
            label={confirmLabel}
            icon={confirmIcon}
            variant={danger ? 'danger' : 'primary'}
            busy={busy === 'confirm'}
            disabled={!!busy}
            onPress={confirm}
            testID={testID ? `${testID}-confirm` : undefined}
          />
        </>
      }
    >
      {message ? <T>{message}</T> : null}
      {children}
      {failed ? <Notice tone="danger">{t('errors.generic')}</Notice> : null}
    </Dialog>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.sm }}>
      <T variant="label" tone="secondary" role="heading" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{children}</T>
      {action}
    </Row>
  );
}

export function ColourDot({ color, size = 12 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Screen({
  children, title, actions, scroll = true, testID, onBack, backLabel,
}: {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
  scroll?: boolean;
  testID?: string;
  /** Shows a back chevron before the title. */
  onBack?: () => void;
  /** Its accessible name when "Back" is not specific enough. */
  backLabel?: string;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const header = title || onBack ? (
    <Row style={{ paddingHorizontal: space.xxl, paddingTop: space.xl, paddingBottom: space.md, justifyContent: 'space-between' }}>
      <Row style={{ flexShrink: 1 }}>
        {onBack ? (
          <View style={{ marginLeft: -space.sm }}>
            <IconButton icon="chevronLeft" label={backLabel ?? t('common.back')} onPress={onBack} testID="screen-back" />
          </View>
        ) : null}
        {title ? <T variant="title" role="heading">{title}</T> : null}
      </Row>
      <Row>{actions}</Row>
    </Row>
  ) : null;
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: c.background }}>
      {header}
      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.xxl, paddingBottom: space.xxxl, gap: space.lg }}>{children}</ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.xxl, paddingBottom: space.lg }}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    minHeight: 40,
  },
  buttonSmall: { minHeight: 32, paddingHorizontal: space.md },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, padding: 3, gap: 2, alignSelf: 'flex-start' },
  segment: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: 'transparent' },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
