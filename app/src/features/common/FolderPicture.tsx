import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { Folder, FolderPicture, PortraitLook } from '../../core/model/types';
import { useAppState } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { squarePhoto } from '../../ui/photo';
import { newSeeds, portraitUri } from '../../ui/portraits';
import { Button, Col, Dialog, focusRing, IconButton, Notice, Row, Segmented, T, web } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';

type Pictured = Pick<Folder, 'id' | 'colour' | 'picture'>;

/** A folder's picture in a circle: its photo, or its drawn portrait on a tint of the folder's colour. */
export function FolderAvatar({ folder, size = 40 }: { folder: Pictured; size?: number }) {
  const { c } = useTheme();
  const pic = folder.picture;
  const uri = useMemo(
    () => (pic?.kind === 'photo' ? pic.data : pic?.kind === 'drawn' ? portraitUri(pic.seed, pic.look) : portraitUri(folder.id)),
    [pic, folder.id],
  );
  return (
    // Decorative: the folder's name is always shown beside it.
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}
    >
      {pic?.kind !== 'photo' ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.folder[folder.colour], opacity: 0.3 }]} /> : null}
      <Image source={{ uri }} style={{ width: size - 2, height: size - 2 }} resizeMode="cover" />
    </View>
  );
}

/** The picture section of the folder dialog: arrows to go through drawings, a gallery, or a photo. */
export function PictureField({ folder, onChange }: { folder: Pictured; onChange: (p: FolderPicture | null) => void }) {
  const { platform } = useAppState();
  const { t } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Drawings shown before this one, so the back arrow returns to them.
  const [earlier, setEarlier] = useState<FolderPicture[]>([]);
  const drawn = folder.picture?.kind === 'drawn' ? folder.picture : null;

  function choose(p: FolderPicture) {
    if (folder.picture) setEarlier((e) => [...e.slice(-49), folder.picture!]);
    onChange(p);
  }
  const another = () => choose({ kind: 'drawn', seed: newSeeds(1)[0]!, look: drawn?.look ?? 'any' });
  function previous() {
    const last = earlier[earlier.length - 1];
    if (!last) return;
    setEarlier((e) => e.slice(0, -1));
    onChange(last);
  }

  async function pickPhoto() {
    setError(false);
    const [path] = await platform.dialogs.pickFiles(t('folder.picture.photoTitle'), [{ name: t('folder.picture.images'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }], false);
    if (!path) return;
    setBusy(true);
    try {
      choose({ kind: 'photo', data: await squarePhoto(await platform.files.read(path)) });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row gap={space.lg} align="flex-start">
      <Row gap={space.xs}>
        <IconButton icon="chevronLeft" label={t('folder.picture.previous')} onPress={previous} disabled={earlier.length === 0} testID="picture-previous" />
        <FolderAvatar folder={folder} size={72} />
        <IconButton icon="chevronRight" label={t('folder.picture.next')} onPress={another} testID="picture-next" />
      </Row>
      <Col gap={space.xs} style={{ flex: 1 }}>
        <T variant="label" tone="secondary">{t('folder.picture.title')}</T>
        <T variant="small" tone="muted">{t('folder.picture.hint')}</T>
        <Row wrap style={{ marginTop: space.xs }}>
          <Button small icon="edit" label={t('folder.picture.choose')} onPress={() => setChoosing(true)} testID="picture-choose" />
          <Button small icon="image" label={t('folder.picture.photo')} busy={busy} onPress={() => void pickPhoto()} testID="picture-photo" />
          {folder.picture?.kind === 'photo' ? <Button small variant="ghost" icon="close" label={t('folder.picture.remove')} onPress={() => onChange(null)} testID="picture-remove" /> : null}
        </Row>
        {error ? <Notice tone="warning">{t('folder.picture.unreadable')}</Notice> : null}
      </Col>
      <PortraitPicker
        visible={choosing}
        folder={folder}
        onClose={() => setChoosing(false)}
        onPick={(p) => {
          choose(p);
          setChoosing(false);
        }}
      />
    </Row>
  );
}

const GALLERY = 15;

/** A gallery of drawn portraits to choose from, narrowed by look; "Show others" draws new ones. */
function PortraitPicker({ visible, folder, onClose, onPick }: { visible: boolean; folder: Pictured; onClose: () => void; onPick: (p: FolderPicture) => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const current = folder.picture?.kind === 'drawn' ? folder.picture : null;
  const [look, setLook] = useState<PortraitLook>(current?.look ?? 'any');
  const [seeds, setSeeds] = useState(() => newSeeds(GALLERY));

  return (
    <Dialog
      visible={visible}
      title={t('folder.picture.pickerTitle')}
      onClose={onClose}
      width={600}
      testID="portrait-picker"
      footer={
        <>
          <Button icon="repeat" label={t('folder.picture.more')} onPress={() => setSeeds(newSeeds(GALLERY))} testID="portrait-more" />
          <Button label={t('common.cancel')} onPress={onClose} />
        </>
      }
    >
      <Segmented
        label={t('folder.picture.look')}
        value={look}
        onChange={setLook}
        options={(['any', 'feminine', 'masculine'] as const).map((v) => ({ value: v, label: t(`folder.picture.looks.${v}`) }))}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' }}>
        {seeds.map((seed, i) => (
          <Pressable
            key={seed}
            onPress={() => onPick({ kind: 'drawn', seed, look })}
            accessibilityRole="button"
            accessibilityLabel={t('folder.picture.option', { n: i + 1 })}
            testID={`portrait-${i}`}
            style={(s) => {
              const { hovered, focused } = s as { hovered?: boolean; focused?: boolean };
              return [{ borderRadius: 44, padding: 2, borderWidth: 2, borderColor: hovered ? c.accent : 'transparent' }, focused && focusRing(c.focus), web({ cursor: 'pointer' })];
            }}
          >
            <FolderAvatar folder={{ id: folder.id, colour: folder.colour, picture: { kind: 'drawn', seed, look } }} size={80} />
          </Pressable>
        ))}
      </View>
    </Dialog>
  );
}
