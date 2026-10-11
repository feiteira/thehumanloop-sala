import React from 'react';
import { Pressable, View } from 'react-native';
import { FOLDER_COLOURS, type FolderColour, STICKY_COLOURS, type StickyColour } from '../../core/model/types';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { focusRing, useChoiceGroup, web } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

// Colour swatches are radio groups like the others: one Tab stop, arrow keys move, Space chooses.

export function FolderColourPicker({ value, onChange, label }: { value: FolderColour; onChange: (c: FolderColour) => void; label: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const group = useChoiceGroup({ values: FOLDER_COLOURS, value, onChange });
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {FOLDER_COLOURS.map((col) => (
        <Pressable
          key={col}
          {...group.item(col)}
          accessibilityLabel={t(`colours.${col}`)}
          style={(s) => [
            { width: 30, height: 30, borderRadius: 15, backgroundColor: c.folder[col], alignItems: 'center', justifyContent: 'center' },
            value === col && { borderWidth: 3, borderColor: c.text },
            (s as { focused?: boolean }).focused && focusRing(c.focus),
            web({ cursor: 'pointer' }),
          ]}
        >
          {value === col ? <Icon name="check" size={14} color="#FFFFFF" strokeWidth={3} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function StickyColourPicker({ value, onChange, label }: { value: StickyColour; onChange: (c: StickyColour) => void; label: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const group = useChoiceGroup({ values: STICKY_COLOURS, value, onChange });
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 8 }}>
      {STICKY_COLOURS.map((col) => (
        <Pressable
          key={col}
          {...group.item(col)}
          accessibilityLabel={t(`sticky.colours.${col}`)}
          style={(s) => [
            { width: 30, height: 30, borderRadius: 4, backgroundColor: c.sticky[col].bg, borderWidth: value === col ? 3 : 1, borderColor: value === col ? c.text : c.sticky[col].edge },
            (s as { focused?: boolean }).focused && focusRing(c.focus),
            web({ cursor: 'pointer' }),
          ]}
        />
      ))}
    </View>
  );
}
