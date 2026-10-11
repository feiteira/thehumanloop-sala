import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { cleanTheme, PASSAGE_THEMES_MAX, sameTheme, THEME_MAX, themeKey, uniqueThemes } from '../../core/model/passages';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { ariaState, Button, Col, Dialog, Field, focusRing, Row, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';

/** How many names from other folders are offered at once (the typed letters narrow them). */
const OTHERS_SHOWN = 24;

/**
 * Chooses the themes of some marked words: names typed, or picked from those of this folder
 * and of the rest of the practice. Editing a mark can also remove it.
 */
export function ThemeDialog({
  visible, quote, initial, inFolder, elsewhere, editing, onSave, onUnmark, onClose,
}: {
  visible: boolean;
  quote: string;
  initial: string[];
  /** Themes used in this folder, the most used first. */
  inFolder: string[];
  /** Themes used in other folders, the most recently used first. */
  elsewhere: string[];
  /** The words are already marked: the dialog changes their themes and can remove the mark. */
  editing: boolean;
  onSave: (themes: string[]) => void;
  onUnmark: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const [chosen, setChosen] = useState<string[]>([]);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!visible) return;
    setChosen(initial);
    setTyped('');
  }, [visible, initial]);

  const name = cleanTheme(typed);
  const tooLong = name.length > THEME_MAX;
  const full = chosen.length >= PASSAGE_THEMES_MAX;
  const isChosen = (n: string) => chosen.some((x) => sameTheme(x, n));
  const toggle = (n: string) => setChosen((cur) => (cur.some((x) => sameTheme(x, n)) ? cur.filter((x) => !sameTheme(x, n)) : cur.length >= PASSAGE_THEMES_MAX ? cur : [...cur, n]));
  // A name typed that is already a theme takes that theme's spelling.
  const spelled = (n: string) => [...inFolder, ...elsewhere].find((x) => sameTheme(x, n)) ?? n;

  function add() {
    if (!name || tooLong || full) return;
    if (!isChosen(name)) setChosen((cur) => [...cur, spelled(name)]);
    setTyped('');
  }

  // What Save keeps: the chosen themes, and a name still in the box.
  const result = uniqueThemes(name && !tooLong && !full ? [...chosen, spelled(name)] : chosen);
  const canSave = !tooLong && (result.length > 0 || editing);
  const save = () => {
    if (!canSave) return;
    if (result.length) onSave(result);
    else onUnmark();
    onClose();
  };

  const folderKeys = new Set(inFolder.map(themeKey));
  const typedKey = themeKey(name);
  const others = elsewhere.filter((n) => !folderKeys.has(themeKey(n)) && (!typedKey || themeKey(n).includes(typedKey))).slice(0, OTHERS_SHOWN);
  const ours = inFolder.filter((n) => !typedKey || themeKey(n).includes(typedKey));

  return (
    <Dialog
      visible={visible}
      title={editing ? t('themes.editTitle') : t('themes.newTitle')}
      onClose={onClose}
      onSubmit={canSave ? save : undefined}
      width={520}
      testID="theme-dialog"
      footer={
        <>
          {editing ? (
            <Button
              variant="ghost"
              icon="trash"
              label={t('themes.unmark')}
              onPress={() => {
                onUnmark();
                onClose();
              }}
              testID="theme-unmark"
            />
          ) : null}
          <View style={{ flex: 1 }} />
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={t('common.save')} disabled={!canSave} onPress={save} testID="theme-save" />
        </>
      }
    >
      <View style={{ borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: space.md, paddingVertical: 2 }} testID="theme-quote">
        <T numberOfLines={6} style={{ fontStyle: 'italic' }}>{quote}</T>
      </View>

      <Col gap={space.xs}>
        <Row gap={space.sm} align="flex-end">
          <Field
            label={t('themes.name')}
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={add}
            blurOnSubmit={false}
            placeholder={t('themes.namePlaceholder')}
            autoFocus
            style={{ flex: 1 }}
            error={tooLong ? t('themes.nameTooLong', { n: THEME_MAX }) : full && name ? t('themes.tooMany', { n: PASSAGE_THEMES_MAX }) : null}
            testID="theme-name"
          />
          <Button icon="plus" label={t('themes.add')} onPress={add} disabled={!name || tooLong || full} testID="theme-add" />
        </Row>
        <T variant="small" tone="muted">{t('themes.addHint')}</T>
      </Col>

      {chosen.length ? (
        <Col gap={space.xs}>
          <T variant="label" tone="secondary">{t('themes.chosen')}</T>
          <View testID="theme-chosen" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
            {chosen.map((n) => (
              <Pressable
                key={themeKey(n)}
                onPress={() => toggle(n)}
                accessibilityRole="button"
                accessibilityLabel={t('themes.takeOff', { name: n })}
                style={(s) => [
                  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10, paddingRight: 6, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: c.primarySubtle, borderWidth: 1, borderColor: c.primary },
                  (s as { focused?: boolean }).focused && focusRing(c.focus),
                  web({ cursor: 'pointer' }),
                ]}
              >
                <T variant="small" tone="primary">{n}</T>
                <Icon name="close" size={14} color={c.primary} />
              </Pressable>
            ))}
          </View>
        </Col>
      ) : null}

      {ours.length ? <Suggestions label={t('themes.inFolder')} names={ours} isChosen={isChosen} onToggle={toggle} testID="theme-in-folder" /> : null}
      {others.length ? <Suggestions label={t('themes.elsewhere')} names={others} isChosen={isChosen} onToggle={toggle} testID="theme-elsewhere" /> : null}
    </Dialog>
  );
}

function Suggestions({ label, names, isChosen, onToggle, testID }: { label: string; names: string[]; isChosen: (n: string) => boolean; onToggle: (n: string) => void; testID: string }) {
  const { c } = useTheme();
  return (
    <Col gap={space.xs}>
      <T variant="label" tone="secondary">{label}</T>
      <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
        {names.map((n) => {
          const on = isChosen(n);
          return (
            <Pressable
              key={themeKey(n)}
              onPress={() => onToggle(n)}
              accessibilityRole="button"
              accessibilityLabel={n}
              {...ariaState({ pressed: on })}
              accessibilityState={{ selected: on }} // phones; the web reads aria-pressed
              style={(s) => [
                { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
                { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySubtle : (s as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent' },
                (s as { focused?: boolean }).focused && focusRing(c.focus),
                web({ cursor: 'pointer' }),
              ]}
            >
              <Icon name={on ? 'check' : 'tag'} size={13} color={on ? c.primary : c.textSecondary} />
              <T variant="small" tone={on ? 'primary' : 'secondary'}>{n}</T>
            </Pressable>
          );
        })}
      </View>
    </Col>
  );
}
