import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type TextInput, View } from 'react-native';
import type { Folder } from '../../core/model/types';
import { fold } from '../../core/text/normalize';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Dialog, Field, focusRing, type KeyEventLike, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';

/** A compact button that shows the chosen folder and opens the picker. */
export function FolderButton({ folder, placeholder, onPress, label, testID }: { folder: Folder | null; placeholder: string; onPress: () => void; label: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${folder?.label ?? placeholder}`}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 36, backgroundColor: c.surface, minWidth: 200, maxWidth: 280 },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {folder ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.folder[folder.colour] }} /> : <Icon name="folder" size={16} color={c.textMuted} />}
      <T variant="small" tone={folder ? 'primary' : 'secondary'} numberOfLines={1} style={{ flex: 1 }}>{folder?.label ?? placeholder}</T>
      <Icon name="chevronDown" size={16} color={c.textSecondary} />
    </Pressable>
  );
}

/**
 * Chooses one of the practice's folders (active ones first, archived ones marked), or none when
 * `allowNone`. Type to narrow the list; ↑/↓ move, Enter or Space chooses. One dialog can serve a
 * whole list: open it with the row it is for. Used by the appointment dialog and import review.
 */
export function FolderPickerDialog({
  visible, folders, value, allowNone, onPick, onClose, title, noneLabel,
}: {
  visible: boolean;
  folders: Folder[];
  value: string | null;
  allowNone: boolean;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
  /** Defaults to "Choose a folder". */
  title?: string;
  /** What "no folder" is called here. Defaults to "No folder". */
  noneLabel?: string;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = fold(q);
    return folders
      .filter((f) => !f.merged_into && fold(f.label).includes(needle))
      .sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.label.localeCompare(b.label))
      .slice(0, 50);
  }, [folders, q]);
  const pick = (id: string | null) => {
    onPick(id);
    setQ('');
  };
  const close = () => {
    setQ('');
    onClose();
  };
  // ↑/↓ move between the options; Enter or Space chooses one.
  const options = useRef<(View | null)[]>([]);
  const move = (from: number, by: number) => options.current[from + by]?.focus();
  const ids: (string | null)[] = [...(allowNone ? [null] : []), ...matches.map((f) => f.id)];
  const search = useRef<TextInput>(null);
  return (
    <Dialog visible={visible} title={title ?? t('import.chooseFolder')} onClose={close} onShow={() => search.current?.focus()} width={440} testID="folder-picker">
      <Field
        ref={search}
        value={q}
        onChangeText={setQ}
        placeholder={t('import.searchFolders')}
        accessibilityLabel={t('import.searchFolders')}
        autoFocus
        testID="folder-picker-search"
        // Enter picks the first match of what was typed; with nothing typed it keeps the
        // current choice and closes, rather than picking the first folder by name.
        onSubmitEditing={() => (q.trim() ? matches[0] && pick(matches[0].id) : close())}
      />
      <ScrollView {...({ role: 'listbox' } as object)} accessibilityLabel={title ?? t('import.chooseFolder')} style={{ maxHeight: 360, borderWidth: 1, borderColor: c.border, borderRadius: radius.md }}>
        {ids.map((id, index) => {
          const f = id === null ? null : matches.find((m) => m.id === id)!;
          return (
            <Option
              key={id ?? 'none'}
              ref={(node) => {
                options.current[index] = node;
              }}
              label={f ? f.label : (noneLabel ?? t('import.noFolder'))}
              colour={f ? c.folder[f.colour] : undefined}
              selected={value === id}
              archived={f?.status === 'archived'}
              onPress={() => pick(id)}
              onMove={(by) => move(index, by)}
              testID={f ? `folder-option-${f.label}` : 'folder-option-none'}
            />
          );
        })}
      </ScrollView>
    </Dialog>
  );
}

const Option = React.forwardRef<View, {
  label: string;
  colour?: string;
  selected: boolean;
  archived?: boolean;
  onPress: () => void;
  onMove: (by: 1 | -1) => void;
  testID?: string;
}>(function Option({ label, colour, selected, archived, onPress, onMove, testID }, ref) {
  const { c } = useTheme();
  const { t } = useI18n();
  const onKeyDown = (e: KeyEventLike) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!e.nativeEvent?.repeat) onPress();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      onMove(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      role="option"
      accessibilityLabel={label}
      aria-selected={selected}
      {...({ onKeyDown } as object)}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
        { backgroundColor: selected ? c.primarySubtle : (s as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent' },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {colour ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour }} /> : <View style={{ width: 10 }} />}
      <T variant="small" tone={colour ? 'primary' : 'secondary'} style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      {archived ? <T variant="tiny" tone="muted">{t('import.archived')}</T> : null}
      {selected ? <Icon name="check" size={16} color={c.text} /> : null}
    </Pressable>
  );
});
