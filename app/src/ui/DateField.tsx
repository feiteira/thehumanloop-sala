import React, { useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { addDays, checkLocalDate, checkLocalTime, formatLocalDate, stepTime } from '../core/text/dates';
import { useI18n } from './i18n';
import { Field, type FieldProps } from './primitives';

// Date and time fields that speak the therapist's format (28/09/2026, 9h30) and hand back
// ISO (2026-09-28, 09:30). They report every change, flag a wrong entry when the field is
// left (or at once with `showErrors`), tidy what was typed into the standard form, and step
// with the arrow keys: a day (a week with Shift) or 15 minutes (an hour with Shift).

type Inherited = Omit<FieldProps, 'value' | 'onChange' | 'onChangeText' | 'error' | 'multiline' | 'autoGrow' | 'maxHeight' | 'minHeight'>;

interface Common extends Inherited {
  label: string;
  /** Empty is an error ("Required."). */
  required?: boolean;
  /** Another problem to show, such as "ends before it starts"; it wins over the field's own. */
  error?: string | null;
  /** Show errors now, without waiting for the field to be left (after a Save press, say). */
  showErrors?: boolean;
}

export interface DateFieldProps extends Common {
  /** ISO date (yyyy-MM-dd), or null for none. */
  value: string | null;
  /** `iso` is null when the field is empty or holds no valid date; `valid` tells those apart. */
  onChange: (iso: string | null, valid: boolean) => void;
  /**
   * Today's ISO date in the practice's time zone: "today", "tomorrow", a missing year, the
   * error's example and arrows from empty count from it. Required, because ui/ cannot know
   * the practice's zone and the computer's date is not always the practice's.
   */
  today: string;
}

export interface TimeFieldProps extends Common {
  /** HH:mm, or null for none. */
  value: string | null;
  /** `time` is null when the field is empty or holds no valid time; `valid` tells those apart. */
  onChange: (time: string | null, valid: boolean) => void;
  /** Minutes per arrow press. Default 15. */
  step?: number;
}

type KeyPress = NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }>;

/** Arrow key → steps (Shift for bigger ones), or null for any other key. */
function arrowSteps(e: KeyPress, big: number): number | null {
  const k = e.nativeEvent;
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  const n = k.shiftKey ? big : 1;
  if (k.key === 'ArrowUp') return n;
  if (k.key === 'ArrowDown') return -n;
  return null;
}

/**
 * Text that follows `value` when it changes from outside (a reset, a new record) but not
 * when it is the field's own report coming back, so typing is never rewritten mid-way.
 */
function useEcho(value: string | null, format: (v: string) => string) {
  const [text, setText] = useState(() => (value ? format(value) : ''));
  const [touched, setTouched] = useState(false);
  const reported = useRef(value);
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setText(value ? format(value) : '');
    setTouched(false);
    // `format` changes with the language only; a new language keeps what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return { text, setText, touched, setTouched, reported };
}

export function DateField({ value, onChange, required, error, showErrors, today, label, placeholder, ...rest }: DateFieldProps) {
  const { t, locale } = useI18n();
  const format = (iso: string) => formatLocalDate(iso, locale);
  const { text, setText, touched, setTouched, reported } = useEcho(value, format);
  const check = checkLocalDate(text, locale, { today });

  const report = (iso: string | null, valid: boolean) => {
    reported.current = iso;
    onChange(iso, valid);
  };
  const change = (s: string) => {
    setText(s);
    const r = checkLocalDate(s, locale, { today });
    report(r.ok ? r.iso : null, r.ok || r.reason === 'empty');
  };

  let own: string | null = null;
  if (!check.ok && (touched || showErrors)) {
    if (check.reason === 'format') own = t('errors.dateFormat', { example: format(today) });
    else if (check.reason === 'impossible') own = t('errors.dateImpossible');
    else if (required) own = t('errors.required');
  }

  return (
    <Field
      {...rest}
      label={label}
      value={text}
      placeholder={placeholder ?? t('common.datePattern')}
      error={error || own}
      onChangeText={change}
      onBlur={(e) => {
        setTouched(true);
        if (check.ok) setText(format(check.iso));
        rest.onBlur?.(e);
      }}
      onKeyPress={(e: KeyPress) => {
        const steps = arrowSteps(e, 7);
        if (steps !== null) {
          e.preventDefault();
          // From an empty or unreadable field, the first press lands on today.
          const next = check.ok ? addDays(check.iso, steps) : today;
          setText(format(next));
          report(next, true);
        }
        rest.onKeyPress?.(e);
      }}
    />
  );
}

export function TimeField({ value, onChange, required, error, showErrors, step = 15, label, placeholder, ...rest }: TimeFieldProps) {
  const { t } = useI18n();
  const same = (v: string) => v;
  const { text, setText, touched, setTouched, reported } = useEcho(value, same);
  const check = checkLocalTime(text);

  const report = (time: string | null, valid: boolean) => {
    reported.current = time;
    onChange(time, valid);
  };
  const change = (s: string) => {
    setText(s);
    const r = checkLocalTime(s);
    report(r.ok ? r.time : null, r.ok || r.reason === 'empty');
  };

  let own: string | null = null;
  if (!check.ok && (touched || showErrors)) {
    if (check.reason !== 'empty') own = t('errors.invalidTime');
    else if (required) own = t('errors.required');
  }

  return (
    <Field
      {...rest}
      label={label}
      value={text}
      placeholder={placeholder ?? t('common.timePattern')}
      error={error || own}
      onChangeText={change}
      onBlur={(e) => {
        setTouched(true);
        if (check.ok) setText(check.time);
        rest.onBlur?.(e);
      }}
      onKeyPress={(e: KeyPress) => {
        const steps = arrowSteps(e, Math.max(1, Math.round(60 / step)));
        if (steps !== null) {
          e.preventDefault();
          // From an empty or unreadable field, the first press lands on 09:00.
          const next = check.ok ? stepTime(check.time, steps, step) : '09:00';
          setText(next);
          report(next, true);
        }
        rest.onKeyPress?.(e);
      }}
    />
  );
}
