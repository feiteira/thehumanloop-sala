import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { deviceTimeZone, practiceTimeZone, SETTING, setSetting } from '../../services/settings';
import { searchTimeZones, zoneCity, zoneOffset } from '../../services/timeZones';
import { usePractice } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { ariaState, Button, Col, Dialog, Field, focusRing, Row, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';

const SHOWN = 40;

/** Settings → General: the practice's time zone, chosen from a searchable list. */
export function TimeZoneSetting() {
  const practice = usePractice();
  const { t, locale } = useI18n();
  const [tz, setTz] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => void practiceTimeZone(practice.store).then(setTz), [practice]);

  async function choose(zone: string) {
    await setSetting(practice.store, SETTING.timeZone, zone);
    setTz(zone);
    setSaved(true);
    setOpen(false);
  }

  return (
    <Col gap={space.xs}>
      <T variant="label" tone="secondary">{t('settings.practiceTimeZone')}</T>
      <Row gap={space.lg}>
        <Col gap={0} style={{ flexShrink: 1 }}>
          <T>{tz ? zoneCity(tz, locale) : ''}</T>
          <T variant="small" tone="muted">{tz ? `${tz} · ${zoneOffset(tz)}` : ''}</T>
        </Col>
        <Button
          small
          label={t('common.change')}
          accessibilityLabel={`${t('common.change')}: ${t('settings.practiceTimeZone')}`}
          onPress={() => setOpen(true)}
          disabled={!tz}
          testID="time-zone-change"
        />
      </Row>
      <View aria-live="polite">
        <T variant="small" tone={saved ? 'success' : 'muted'}>{saved ? t('settings.timeZoneSaved') : t('settings.timeZoneHint')}</T>
      </View>
      <TimeZoneDialog visible={open} current={tz} onChoose={(z) => void choose(z)} onClose={() => setOpen(false)} />
    </Col>
  );
}

function TimeZoneDialog({ visible, current, onChoose, onClose }: { visible: boolean; current: string | null; onChoose: (zone: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (visible) setQ('');
  }, [visible]);
  const results = useMemo(
    () => (visible ? searchTimeZones(q, { current: current ?? undefined, device: deviceTimeZone(), limit: SHOWN + 1 }) : []),
    [visible, q, current],
  );
  const shown = results.slice(0, SHOWN);
  const none = q.trim() !== '' && shown.length === 0;

  return (
    <Dialog visible={visible} title={t('settings.timeZoneTitle')} onClose={onClose} width={520} testID="time-zone-dialog">
      <Field
        label={t('settings.timeZoneSearch')}
        value={q}
        onChangeText={setQ}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => shown[0] && onChoose(shown[0])}
        error={none ? t('settings.timeZoneNone', { q: q.trim() }) : null}
        testID="time-zone-search"
      />
      <View role="list" accessibilityLabel={t('settings.timeZoneList')} style={{ gap: 2 }}>
        {shown.map((zone) => {
          const chosen = zone === current;
          const city = zoneCity(zone, locale);
          const detail = `${zone} · ${zoneOffset(zone)}`;
          return (
            <View key={zone} role="listitem">
              <Pressable
                onPress={() => onChoose(zone)}
                accessibilityRole="button"
                accessibilityLabel={`${city}, ${detail}`}
                {...ariaState({ current: chosen })}
                testID={`time-zone-${zone}`}
                style={(s) => {
                  const { hovered, focused } = s as { hovered?: boolean; focused?: boolean };
                  return [
                    { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.md },
                    { backgroundColor: chosen ? c.primarySubtle : hovered ? c.surfaceAlt : 'transparent' },
                    focused && focusRing(c.focus),
                    web({ cursor: 'pointer' }),
                  ];
                }}
              >
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: chosen ? '600' : '400' }}>{city}</T>
                  <T variant="small" tone="muted">{detail}</T>
                </View>
                {chosen ? <Icon name="check" size={18} color={c.text} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
      {results.length > SHOWN ? <T variant="small" tone="muted">{t('settings.timeZoneMore')}</T> : null}
    </Dialog>
  );
}
