import React, { type ReactNode, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { emptyContact, type Folder, type FolderColour, FOLDER_LABEL_MAX, type FolderPicture } from '../../core/model/types';
import { newSeeds } from '../../ui/portraits';
import { usePractice } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { ariaState, Button, Col, Dialog, Field, focusRing, Notice, Row, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { PictureField } from './FolderPicture';
import { FolderColourPicker } from './pickers';

export function FolderDialog({
  visible, onClose, folder, onSaved, defaultLabel, title, notice,
}: {
  visible: boolean;
  onClose: () => void;
  folder?: Folder | null;
  onSaved?: (f: Folder) => void;
  /** The name a new folder starts with. */
  defaultLabel?: string;
  title?: string;
  /** Shown above the fields. */
  notice?: ReactNode;
}) {
  const practice = usePractice();
  const { t } = useI18n();
  const { c } = useTheme();
  const [label, setLabel] = useState('');
  const [colour, setColour] = useState<FolderColour>('teal');
  const [picture, setPicture] = useState<FolderPicture | null>(null);
  // A new folder has no id yet: its portrait gets a seed of its own.
  const [newSeed, setNewSeed] = useState('');
  const [tags, setTags] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [moreDetails, setMoreDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(folder?.label ?? defaultLabel ?? '');
    setColour(folder?.colour ?? 'teal');
    setPicture(folder ? folder.picture ?? null : { kind: 'drawn', seed: newSeeds(1)[0]!, look: 'any' });
    setNewSeed(newSeeds(1)[0]!);
    setTags(folder?.tags.join(', ') ?? '');
    setCoverNote(folder?.cover_note ?? '');
    setEmail(folder?.contact.email ?? '');
    setPhone(folder?.contact.phone ?? '');
    setLanguage(folder?.contact.language ?? '');
    setTimeZone(folder?.contact.time_zone ?? '');
    setShowErrors(false);
    // Language and time zone are rarely needed: shown when already filled in.
    setMoreDetails(!!(folder?.contact.language || folder?.contact.time_zone));
    setBusy(false);
    setFailed(false);
  }, [visible, folder, defaultLabel]);

  const labelError = !label.trim() ? (showErrors ? t('errors.required') : null) : label.trim().length > FOLDER_LABEL_MAX ? t('folder.labelTooLong', { n: FOLDER_LABEL_MAX }) : null;

  async function save() {
    if (busy) return;
    if (!label.trim() || label.trim().length > FOLDER_LABEL_MAX) {
      setShowErrors(true);
      return;
    }
    const draft = {
      label,
      colour,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      cover_note: coverNote.trim(),
      picture,
      contact: { ...emptyContact(), email: email.trim(), phone: phone.trim(), language: language.trim().toLowerCase(), time_zone: timeZone.trim() },
    };
    setBusy(true);
    setFailed(false);
    try {
      const saved = folder
        ? await practice.store.update('folder', folder.id, draft)
        : await practice.store.put('folder', { ...draft, status: 'active', archived_at: null, merged_into: null });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      visible={visible}
      title={title ?? (folder ? t('folder.editTitle') : t('folder.newTitle'))}
      onClose={onClose}
      onSubmit={busy ? undefined : () => void save()}
      width={560}
      testID="folder-dialog"
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={folder ? t('common.save') : t('folder.create')} onPress={() => void save()} busy={busy} testID="save-folder" />
        </>
      }
    >
      <Col gap={space.md}>
        {notice}
        <Field
          label={t('folder.label')}
          hint={t('folder.labelHint')}
          value={label}
          onChangeText={setLabel}
          autoFocus
          testID="folder-label"
          error={labelError}
          onSubmitEditing={() => void save()}
        />
        <View style={{ gap: space.xs }}>
          <T variant="label" tone="secondary">{t('folder.colour')}</T>
          <FolderColourPicker value={colour} onChange={setColour} label={t('folder.colour')} />
        </View>
        <PictureField key={`${folder?.id ?? newSeed}-${visible}`} folder={{ id: folder?.id ?? newSeed, colour, picture }} onChange={setPicture} />
        <Field label={t('folder.tags')} hint={t('folder.tagsHint')} value={tags} onChangeText={setTags} />
        <Field label={t('folder.coverNote')} hint={t('folder.coverNoteHint')} value={coverNote} onChangeText={setCoverNote} />
        <T variant="label" tone="secondary" style={{ marginTop: space.sm }}>{t('folder.contact')}</T>
        <Row gap={space.md} align="flex-start">
          <Field style={{ flex: 1 }} label={t('folder.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field style={{ flex: 1 }} label={t('folder.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </Row>
        <Pressable
          onPress={() => setMoreDetails(!moreDetails)}
          accessibilityRole="button"
          accessibilityLabel={t('folder.moreDetails')}
          {...ariaState({ expanded: moreDetails })}
          testID="folder-more-details"
          style={(s) => [
            { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', paddingVertical: space.xs, paddingRight: space.sm, borderRadius: radius.sm },
            (s as { focused?: boolean }).focused && focusRing(c.focus),
            web({ cursor: 'pointer' }),
          ]}
        >
          <Icon name={moreDetails ? 'chevronDown' : 'chevronRight'} size={16} color={c.textSecondary} />
          <T variant="label" tone="secondary">{t('folder.moreDetails')}</T>
        </Pressable>
        {moreDetails ? (
          <Row gap={space.md} align="flex-start">
            <Field style={{ flex: 1 }} label={t('folder.language')} value={language} onChangeText={setLanguage} placeholder="pt, es, en…" autoCapitalize="none" />
            <Field style={{ flex: 2 }} label={t('folder.timeZone')} hint={t('folder.timeZoneHint')} value={timeZone} onChangeText={setTimeZone} placeholder="Europe/Lisbon" autoCapitalize="none" />
          </Row>
        ) : null}
        {failed ? <Notice tone="danger">{t('errors.generic')}</Notice> : null}
      </Col>
    </Dialog>
  );
}
