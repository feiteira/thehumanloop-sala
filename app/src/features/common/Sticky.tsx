import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { type StickyColour, STICKY_MAX, type Sticky } from '../../core/model/types';
import { usePractice } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Button, Checkbox, Col, Dialog, Field, focusRing, IconButton, T, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { StickyColourPicker } from './pickers';

/** A sticky note as it sits on a cover, a page or the Today view. */
export function StickyCard({
  sticky, onEdit, onPeel, width = 176, caption, testID,
}: {
  sticky: Sticky;
  onEdit?: () => void;
  onPeel?: () => void;
  width?: number | `${number}%`;
  caption?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const col = c.sticky[sticky.colour];
  const peeled = sticky.state === 'peeled';
  const suggested = sticky.origin === 'ai';
  return (
    <View
      style={[
        {
          width,
          minHeight: 84,
          backgroundColor: col.bg,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: col.edge,
          borderStyle: suggested ? 'dashed' : 'solid',
          opacity: peeled ? 0.7 : 1,
          transform: [{ rotate: `${((sticky.id.charCodeAt(0) % 5) - 2) * 0.4}deg` }],
        },
        web({ boxShadow: '0 1px 2px rgba(16,38,44,0.12), 0 3px 8px rgba(16,38,44,0.06)' }),
      ]}
    >
      <Pressable
        testID={testID}
        onPress={onEdit}
        disabled={!onEdit}
        accessibilityRole={onEdit ? 'button' : 'text'}
        accessibilityLabel={onEdit ? `${t('sticky.editTitle')}: ${sticky.text}` : sticky.text}
        style={(s) => [
          { flex: 1, padding: space.sm, paddingRight: onPeel ? 30 : space.sm, borderRadius: 3 },
          web({ cursor: onEdit ? 'pointer' : 'default' }),
          (s as { focused?: boolean }).focused && focusRing(c.focus),
        ]}
      >
        <T variant="small" style={[{ color: col.text }, peeled && { textDecorationLine: 'line-through' }]}>{sticky.text}</T>
        {sticky.next_session || caption ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            {sticky.next_session ? <Icon name="clock" size={12} color={col.text} /> : null}
            <T variant="tiny" style={{ color: col.text, opacity: 0.8 }}>{caption ?? t('sticky.nextSessionShort')}</T>
          </View>
        ) : null}
      </Pressable>
      {onPeel ? (
        <View style={{ position: 'absolute', top: 2, right: 2 }}>
          {/* Named with its text: Today can show several notes, each with this button. */}
          <IconButton icon={peeled ? 'restore' : 'peel'} size={26} label={`${peeled ? t('sticky.unpeel') : t('sticky.peel')}: ${sticky.text}`} onPress={onPeel} />
        </View>
      ) : null}
    </View>
  );
}

export function AddStickyButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="add-sticky"
      style={(s) => [
        { width: 120, minHeight: 84, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border, alignItems: 'center', justifyContent: 'center', gap: 4, padding: space.sm },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <Icon name="plus" size={18} color={c.textSecondary} />
      <T variant="tiny" tone="secondary" style={{ textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
}

/** Creates or edits a sticky note on a folder cover or a page. */
export function StickyDialog({
  visible, onClose, folderId, pageId, sticky,
}: {
  visible: boolean;
  onClose: () => void;
  folderId: string;
  pageId: string | null;
  sticky?: Sticky | null;
}) {
  const practice = usePractice();
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState('');
  const [colour, setColour] = useState<StickyColour>('yellow');
  const [nextSession, setNextSession] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setText(sticky?.text ?? '');
    setColour(sticky?.colour ?? 'yellow');
    setNextSession(sticky?.next_session ?? false);
  }, [visible, sticky]);

  const tooLong = text.trim().length > STICKY_MAX;

  async function save() {
    if (!text.trim() || tooLong) return;
    try {
      if (sticky) await practice.store.update('sticky', sticky.id, { text, colour, next_session: nextSession });
      else
        await practice.store.put('sticky', {
          folder_id: folderId, page_id: pageId, text, colour, next_session: nextSession, origin: 'therapist', state: 'stuck', peeled_at: null,
        });
    } catch {
      toast.show({ message: t('errors.generic') });
      return;
    }
    onClose();
  }

  async function remove() {
    if (sticky) {
      const id = sticky.id;
      try {
        await practice.store.remove('sticky', [id]);
      } catch {
        toast.show({ message: t('errors.generic') });
        return;
      }
      toast.undo(t('sticky.deleted'), () => practice.store.restore('sticky', [id]));
    }
    onClose();
  }

  return (
    <Dialog
      visible={visible}
      title={sticky ? t('sticky.editTitle') : t('sticky.newTitle')}
      onClose={onClose}
      onSubmit={text.trim() && !tooLong ? () => void save() : undefined}
      width={440}
      testID="sticky-dialog"
      footer={
        <>
          {sticky ? <Button variant="ghost" icon="trash" label={t('common.delete')} onPress={() => void remove()} /> : null}
          <View style={{ flex: 1 }} />
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={t('common.save')} disabled={!text.trim() || tooLong} onPress={() => void save()} testID="save-sticky" />
        </>
      }
    >
      <Col gap={space.md}>
        <Field
          value={text}
          onChangeText={setText}
          placeholder={t('sticky.placeholder')}
          multiline
          minHeight={90}
          autoFocus
          accessibilityLabel={t('sticky.placeholder')}
          testID="sticky-text"
          error={tooLong ? t('sticky.tooLong', { n: STICKY_MAX }) : null}
          hint={`${text.trim().length} / ${STICKY_MAX}`}
        />
        <StickyColourPicker value={colour} onChange={setColour} label={t('sticky.colour')} />
        <Checkbox checked={nextSession} onChange={setNextSession} label={t('sticky.nextSession')} />
      </Col>
    </Dialog>
  );
}

export async function togglePeel(practice: ReturnType<typeof usePractice>, s: Sticky): Promise<void> {
  const peeled = s.state === 'peeled';
  await practice.store.update('sticky', s.id, { state: peeled ? 'stuck' : 'peeled', peeled_at: peeled ? null : new Date().toISOString() });
}

/** Peels a note off (or sticks it back); peeling offers Undo. */
export function usePeel(): (s: Sticky) => Promise<void> {
  const practice = usePractice();
  const { t } = useI18n();
  const toast = useToast();
  return async (s) => {
    try {
      await togglePeel(practice, s);
    } catch {
      toast.show({ message: t('errors.generic') });
      return;
    }
    if (s.state !== 'peeled') toast.undo(t('sticky.peeled'), () => togglePeel(practice, { ...s, state: 'peeled' }));
  };
}
