import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useI18n, type MessageKey } from '../ui/i18n';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { focusRing, T, web } from '../ui/primitives';
import { font, radius, space, useTheme } from '../ui/theme';
import { watchActivity, watchBack, watchShortcuts } from './activity';
import { useAppState } from './AppState';
import { BackupLine, BackupProvider } from './BackupProvider';
import { watchHelpKey } from './helpKey';
import { helpTopicFor } from './helpTopic';
import { useKeyLabel } from './keys';
import { LockingScreen } from './LockingScreen';
import { Kbd, QuickOpen } from './QuickOpen';
import { focusedElement, refocus } from './refocus';
import { type Route, useRouter } from './router';
import { AlertHost, LoopNavItem } from '../loopBridge';
import { dailyCheck } from '../services/updates';
import { useKnownUpdate } from './useKnownUpdate';

const NAV: { route: Route; icon: IconName; label: MessageKey; key: string }[] = [
  { route: { name: 'today' }, icon: 'today', label: 'nav.today', key: 'today' },
  { route: { name: 'shelf' }, icon: 'shelf', label: 'nav.shelf', key: 'shelf' },
  { route: { name: 'calendar' }, icon: 'calendar', label: 'nav.calendar', key: 'calendar' },
  { route: { name: 'import' }, icon: 'import', label: 'nav.import', key: 'import' },
];

const NAV_BOTTOM: { route: Route; icon: IconName; label: MessageKey; key: string }[] = [
  { route: { name: 'help' }, icon: 'help', label: 'nav.help', key: 'help' },
  { route: { name: 'settings' }, icon: 'settings', label: 'nav.settings', key: 'settings' },
];

function activeKey(route: Route): string {
  if (route.name === 'loopHome') return 'loop';
  return route.name === 'folder' ? 'shelf' : route.name;
}

function NavItem({ icon, label, active, onPress, testID }: { icon: IconName; label: string; active: boolean; onPress: () => void; testID: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      aria-current={active ? 'page' : undefined}
      accessibilityState={{ selected: active }} // phones; the web reads aria-current
      style={(state) => {
        const { hovered, focused } = state as { hovered?: boolean; focused?: boolean };
        return [
          { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 9, borderRadius: radius.md },
          { backgroundColor: active ? c.primarySubtle : hovered ? c.surfaceAlt : 'transparent' },
          focused && focusRing(c.focus),
          web({ cursor: 'pointer' }),
        ];
      }}
    >
      <Icon name={icon} size={19} color={active ? c.text : c.textSecondary} />
      <T variant="body" tone={active ? 'primary' : 'secondary'} style={{ fontWeight: active ? '600' : '500' }}>{label}</T>
    </Pressable>
  );
}

/** Shown in the menu when a newer Sala is out; opens Settings → About Sala. */
function UpdateNavItem({ onPress }: { onPress: () => void }) {
  const update = useKnownUpdate();
  const { c } = useTheme();
  const { t } = useI18n();
  if (!update?.newer) return null;
  return (
    <Pressable
      testID="nav-update"
      onPress={onPress}
      accessibilityRole="link"
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.sm, borderRadius: radius.md, backgroundColor: c.infoBg },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <Icon name="download" size={18} color={c.infoText} />
      <T variant="small" style={{ color: c.infoText, fontWeight: '600', flex: 1 }}>{t('updates.nav', { v: update.latest })}</T>
    </Pressable>
  );
}

/** The way into Find from the menu, with its shortcut. */
function FindItem({ onPress }: { onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const key = useKeyLabel();
  return (
    <Pressable
      testID="nav-find"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('nav.find')}
      {...({ 'aria-keyshortcuts': 'Control+K' } as object)}
      style={(state) => {
        const { hovered, focused } = state as { hovered?: boolean; focused?: boolean };
        return [
          { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 7, marginBottom: space.md, borderRadius: radius.md, borderWidth: 1 },
          { borderColor: c.border, backgroundColor: hovered ? c.surfaceAlt : c.surfaceSunken },
          focused && focusRing(c.focus),
          web({ cursor: 'pointer' }),
        ];
      }}
    >
      <Icon name="search" size={17} color={c.textSecondary} />
      <T variant="body" tone="secondary" style={{ flex: 1 }}>{t('nav.find')}</T>
      <Kbd>{key('K')}</Kbd>
    </Pressable>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <BackupProvider>
      <ShellLayout>{children}</ShellLayout>
    </BackupProvider>
  );
}

function ShellLayout({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const { route, go, back } = useRouter();
  const { lock, prefs, example, platform, isHeld } = useAppState();
  const active = activeKey(route);
  // Find (Ctrl+K): closing it gives the focus back to where the therapist was typing.
  const [finding, setFinding] = useState(false);
  const findOrigin = useRef<unknown>(null);
  const openFind = useCallback(() => {
    if (!finding) findOrigin.current = focusedElement();
    setFinding(true);
  }, [finding]);
  const closeFind = useCallback(() => setFinding(false), []);
  const findGone = useCallback(() => refocus(findOrigin.current), []);

  // New versions: only when the therapist turned the daily check on (services/updates.ts).
  // Sala may stay open for days, so look again every hour; the check itself runs once a day.
  useEffect(() => {
    void dailyCheck(platform);
    const timer = setInterval(() => void dailyCheck(platform), 60 * 60_000);
    return () => clearInterval(timer);
  }, [platform]);

  // Auto-lock after inactivity. Long work (an import, a scan being read) holds it off, and the
  // countdown starts again when that work ends.
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const stop = watchActivity(() => (lastActive.current = Date.now()));
    const timer = setInterval(() => {
      if (isHeld()) lastActive.current = Date.now();
      else if (Date.now() - lastActive.current > prefs.autoLockMinutes * 60_000) void lock('idle');
    }, 15_000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [lock, isHeld, prefs.autoLockMinutes]);

  // Alt+Left and the mouse's back button.
  useEffect(() => watchBack(back), [back]);

  // Only Ctrl+L also works while a dialog is open; the others would move away under it.
  useEffect(
    () =>
      watchShortcuts(
        {
          l: () => void lock(),
          '1': () => go({ name: 'today' }),
          '2': () => go({ name: 'shelf' }),
          '3': () => go({ name: 'calendar' }),
          k: openFind,
          f: openFind,
        },
        ['l'],
      ),
    [go, lock, openFind],
  );

  // F1: the manual, at the section for this screen.
  useEffect(
    () =>
      watchHelpKey(() => {
        const topic = helpTopicFor(route);
        if (topic) go({ name: 'help', topic });
      }),
    [route, go],
  );

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.background }}>
      <View
        role="navigation"
        accessibilityLabel={t('nav.main')}
        style={{ width: 232, backgroundColor: c.surface, borderRightWidth: 1, borderRightColor: c.border, paddingHorizontal: space.md, paddingVertical: space.lg, gap: 2 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, marginBottom: space.lg }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="folder" size={17} color={c.accent} />
          </View>
          <T variant="title" style={{ fontFamily: font.serif }}>Sala</T>
        </View>
        <FindItem onPress={openFind} />
        {example ? (
          <View testID="example-badge" style={{ backgroundColor: c.warningBg, borderRadius: radius.md, padding: space.sm, marginBottom: space.md, gap: 2 }}>
            <T variant="label" style={{ color: c.warningText }}>{t('example.badge')}</T>
            <T variant="tiny" style={{ color: c.warningText }}>{t('example.body')}</T>
          </View>
        ) : null}
        {NAV.map((n) => (
          <NavItem key={n.key} testID={`nav-${n.key}`} icon={n.icon} label={t(n.label)} active={active === n.key} onPress={() => go(n.route)} />
        ))}
        <LoopNavItem active={active === 'loop'} />
        <View style={{ flex: 1 }} />
        <UpdateNavItem onPress={() => go({ name: 'settings', section: 'about' })} />
        {NAV_BOTTOM.map((n) => (
          <NavItem key={n.key} testID={`nav-${n.key}`} icon={n.icon} label={t(n.label)} active={active === n.key} onPress={() => go(n.route)} />
        ))}
        <NavItem testID="nav-lock" icon="lock" label={t('nav.lock')} active={false} onPress={() => void lock()} />
        <View style={{ height: 1, backgroundColor: c.divider, marginVertical: space.sm }} />
        <BackupLine />
      </View>
      <View style={{ flex: 1 }} role={'main' as never}>
        {children}
      </View>
      <QuickOpen open={finding} onClose={closeFind} onGone={findGone} />
      <AlertHost />
      <LockingScreen />
    </View>
  );
}
