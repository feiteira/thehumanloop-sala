import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { DateTime } from 'luxon';
import type { Occurrence } from '../../core/calendar/occurrences';
import type { Folder } from '../../core/model/types';
import { sessionKey } from '../../services/today';
import { useI18n } from '../../ui/i18n';
import { Button, Card, Col, focusRing, Row, SectionTitle, T, web } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';
import { FolderAvatar } from '../common/FolderPicture';
import { dayAndTime } from '../common/dates';

const FIRST = 5;

/**
 * Sessions of the last two weeks that ended without a page: each can get its note, or be
 * marked as needing none. Hidden when there are none; long lists show the newest five first.
 */
export function NotesToWrite({
  sessions, folders, tz, now, onWrite, onNoNote,
}: {
  sessions: Occurrence[];
  folders: Map<string, Folder>;
  tz: string;
  now: DateTime;
  onWrite: (o: Occurrence) => void;
  onNoNote: (o: Occurrence) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const [all, setAll] = useState(false);
  const rows = sessions.flatMap((o) => {
    const folder = o.appointment.folder_id ? folders.get(o.appointment.folder_id) : undefined;
    return folder ? [{ o, folder }] : [];
  });
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <Col gap={space.md}>
      <SectionTitle>{`${t('today.notesToWrite')} (${rows.length})`}</SectionTitle>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {shown.map(({ o, folder }, i) => {
          const start = o.start.setZone(tz);
          const when = dayAndTime(i18n, start, now);
          return (
            <View
              key={sessionKey(o)}
              testID="note-to-write"
              style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.sm, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: c.divider }}
            >
              <Row gap={space.md} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200 }}>
                <FolderAvatar folder={folder} size={32} />
                <Col gap={0} style={{ flex: 1 }}>
                  <T variant="label" numberOfLines={1}>{folder.label}</T>
                  <T variant="small" tone="secondary">{when}</T>
                </Col>
              </Row>
              <Row gap={space.xs} style={{ marginLeft: 'auto' }}>
                <Button
                  small
                  variant="ghost"
                  label={t('today.noNoteNeeded')}
                  accessibilityLabel={t('today.noNoteNeededFor', { name: folder.label, when })}
                  onPress={() => onNoNote(o)}
                />
                <Button
                  small
                  icon="edit"
                  label={t('today.writeNote')}
                  accessibilityLabel={t('today.writeNoteFor', { name: folder.label, time: when })}
                  onPress={() => onWrite(o)}
                />
              </Row>
            </View>
          );
        })}
        {rows.length > FIRST ? (
          <Pressable
            onPress={() => setAll(!all)}
            accessibilityRole="button"
            {...({ 'aria-expanded': all } as object)}
            style={(s) => [
              { padding: space.md, borderTopWidth: 1, borderTopColor: c.divider, alignItems: 'center' },
              (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
              (s as { focused?: boolean }).focused && focusRing(c.focus),
              web({ cursor: 'pointer' }),
            ]}
          >
            <T variant="label" tone="accent">{all ? t('today.showFewer') : t('today.showAll', { n: rows.length })}</T>
          </Pressable>
        ) : null}
      </Card>
    </Col>
  );
}
