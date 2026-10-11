import React from 'react';
import { Pressable, View } from 'react-native';
import type { DateTime } from 'luxon';
import type { Page, Sticky } from '../../core/model/types';
import { pagePreview } from '../../services/today';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { focusRing, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { sessionDate } from '../common/dates';

/**
 * What to have in mind before the session that is on now, or comes next: the sticky notes on
 * the patient's folder cover and a few lines of the folder's last page before it (its plan, or
 * where the note ended). That page is called the last note, not the last session: the last
 * session may still be waiting for its note. Shown inside that session's card on Today.
 */
export function UpNextDetails({
  stickies, previous, indent, now, onOpenPage,
}: {
  stickies: Sticky[];
  previous: Page | null;
  /** Lines the details up with the name above them. */
  indent: number;
  now: DateTime;
  onOpenPage: (page: Page) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const preview = previous ? pagePreview(previous) : null;
  const when = previous ? sessionDate(i18n, previous.date, now.toISODate()!) : '';
  return (
    <View testID="up-next" style={{ borderTopWidth: 1, borderTopColor: c.divider, paddingVertical: space.md, paddingRight: space.md, paddingLeft: indent, gap: space.md }}>
      {stickies.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {stickies.map((s) => (
            <StickyLine key={s.id} sticky={s} />
          ))}
        </View>
      ) : null}
      {previous ? (
        <Pressable
          onPress={() => onOpenPage(previous)}
          accessibilityRole="link"
          accessibilityLabel={`${t('today.lastNote', { date: when })}${preview ? `: ${preview.text}` : ''}`}
          testID="up-next-last-page"
          style={(s) => [
            { gap: 2, borderRadius: radius.sm, alignSelf: 'flex-start', maxWidth: 640, padding: space.xs, margin: -space.xs },
            (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
            (s as { focused?: boolean }).focused && focusRing(c.focus),
            web({ cursor: 'pointer' }),
          ]}
        >
          <T variant="tiny" tone="muted">{t('today.lastNote', { date: when })}</T>
          {preview ? (
            <T variant="small" numberOfLines={3}>
              {preview.kind === 'plan' ? <T variant="label">{`${t('today.plan')}: `}</T> : null}
              {preview.text}
            </T>
          ) : (
            <T variant="small" tone="secondary">{previous.title || t('page.untitled')}</T>
          )}
        </Pressable>
      ) : (
        <T variant="small" tone="muted">{t('today.noEarlierPages')}</T>
      )}
    </View>
  );
}

/** A cover sticky note, small and read-only: its colour, its text, and the clock when it is for the next session. */
function StickyLine({ sticky }: { sticky: Sticky }) {
  const { c } = useTheme();
  const col = c.sticky[sticky.colour];
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, maxWidth: 280,
        backgroundColor: col.bg, borderColor: col.edge, borderWidth: 1, borderRadius: 3,
        paddingHorizontal: space.sm, paddingVertical: space.xs,
      }}
    >
      {sticky.next_session ? <View style={{ marginTop: 2 }}><Icon name="clock" size={12} color={col.text} /></View> : null}
      <T variant="small" style={{ color: col.text, flexShrink: 1 }} numberOfLines={3}>{sticky.text}</T>
    </View>
  );
}
