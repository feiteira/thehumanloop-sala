import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CalendarScreen } from './features/calendar/Calendar';
import { usePracticeTz } from './features/common/hooks';
import { FolderScreen } from './features/folder/Folder';
import { Help } from './features/help/Help';
import { ImportWizard } from './features/import/ImportWizard';
import { Unlock } from './features/onboarding/Unlock';
import { Welcome } from './features/onboarding/Welcome';
import { Settings } from './features/settings/Settings';
import { Shelf } from './features/shelf/Shelf';
import { Today } from './features/today/Today';
import { LoopHome, LoopScreen } from './loopBridge';
import type { Platform } from './platform/types';
import { AppStateProvider, type Phase, useAppState, usePractice } from './shell/AppState';
import { BetaRibbon } from './shell/BetaRibbon';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { type FolderTab, type Route, RouterProvider, useRouter } from './shell/router';
import { Shell } from './shell/Shell';
import { I18nProvider, useI18n } from './ui/i18n';
import { ThemeProvider, useTheme } from './ui/theme';
import { ToastProvider } from './ui/Toast';

function Screen() {
  const { route, routeKey, canGoBack, back } = useRouter();
  switch (route.name) {
    case 'today':
      return <Today />;
    case 'shelf':
      // Keyed on the place, not on the query: the shelf writes its search into its own route.
      return <Shelf key={routeKey} archived={route.archived} q={route.q} tag={route.tag} />;
    case 'folder':
      return <LiveFolder key={route.id} id={route.id} tab={route.tab} pageId={route.pageId} passage={route.passage} />;
    case 'calendar':
      return <CalendarScreen date={route.date} view={route.view} />;
    case 'import':
      return <ImportWizard />;
    case 'settings':
      // Keyed on the place: Settings writes the section on screen into its own route.
      return <Settings key={routeKey} section={route.section} />;
    case 'help':
      return <Help key={route.topic} topic={route.topic} onBack={canGoBack ? back : undefined} />;
    case 'loopHome':
      return <LoopHome />;
    case 'loop':
      return <LoopScreen key={`${route.screen}-${JSON.stringify(route.params ?? {})}`} screen={route.screen} params={route.params} />;
  }
}

/**
 * A folder, once it is known to be there. Back can reach a folder deleted since it was
 * visited; that visit, and every other one to it, then leaves the history.
 */
function LiveFolder({ id, tab, pageId, passage }: { id: string; tab?: FolderTab; pageId?: string; passage?: string }) {
  const practice = usePractice();
  const { dropFolder } = useRouter();
  const [live, setLive] = useState(false);
  useEffect(() => {
    let current = true;
    void practice.store.get('folder', id).then((f) => {
      if (!current) return;
      if (f && !f.deleted) setLive(true);
      else dropFolder(id);
    });
    return () => {
      current = false;
    };
  }, [practice, id, dropFolder]);
  return live ? <FolderScreen id={id} tab={tab} pageId={pageId} passage={passage} /> : null;
}

/** Keeps the app state told where the practice is, for returning there after an idle lock. */
function RouteMemory({ practiceId }: { practiceId: string }) {
  const { route } = useRouter();
  const { noteRoute } = useAppState();
  const tz = usePracticeTz();
  useEffect(() => noteRoute(practiceId, route, tz), [noteRoute, practiceId, route, tz]);
  return null;
}

function Root({ initialRoute }: { initialRoute?: Route }) {
  const { phase } = useAppState();
  const { c } = useTheme();
  if (phase.name === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
        <ActivityIndicator color={c.textSecondary} />
      </View>
    );
  }
  if (phase.name === 'welcome') return <Welcome />;
  if (phase.name === 'locked') return <Unlock reason={phase.reason} />;
  const practiceId = phase.practice.store.practiceId;
  return (
    // A new router each time the practice opens: Today, or where Sala was when it locked itself.
    <RouterProvider key={practiceId} initial={phase.resume ?? initialRoute ?? (phase.fresh ? { name: 'shelf' } : { name: 'today' })}>
      <RouteMemory practiceId={practiceId} />
      <ToastProvider>
        <Shell>
          <Screen />
        </Shell>
      </ToastProvider>
    </RouterProvider>
  );
}

/** The example practice says so in the window title too. */
function WindowTitle() {
  const { platform, example } = useAppState();
  const { t } = useI18n();
  React.useEffect(() => {
    if (example) void platform.setTitle(t('example.windowTitle'));
  }, [platform, example, t]);
  return null;
}

function Themed({ initialRoute }: { initialRoute?: Route }) {
  const { prefs } = useAppState();
  return (
    <I18nProvider locale={prefs.locale}>
      <ThemeProvider mode={prefs.theme}>
        <Background>
          <ErrorBoundary>
            <Root initialRoute={initialRoute} />
          </ErrorBoundary>
          <BetaRibbon />
          <WindowTitle />
        </Background>
      </ThemeProvider>
    </I18nProvider>
  );
}

function Background({ children }: { children: React.ReactNode }) {
  const { c, scheme } = useTheme();
  React.useEffect(() => {
    document.documentElement.style.colorScheme = scheme;
    document.body.style.backgroundColor = c.background;
  }, [c, scheme]);
  return <View style={{ flex: 1, backgroundColor: c.background }}>{children}</View>;
}

export function App({ platform, initialPhase, initialRoute }: { platform: Platform; initialPhase?: Phase; initialRoute?: Route }) {
  return (
    <AppStateProvider platform={platform} initialPhase={initialPhase}>
      <Themed initialRoute={initialRoute} />
    </AppStateProvider>
  );
}
