import type { Route } from './router';

/** The manual's section for a screen (a key of TOPICS in features/help/manual.ts), for F1. Null on Help itself. */
export function helpTopicFor(route: Route): string | null {
  switch (route.name) {
    case 'today':
    case 'shelf':
    case 'calendar':
    case 'import':
      return route.name;
    case 'folder':
      if (route.tab === 'calendar') return 'appointment';
      if (route.tab === 'documents') return 'documents';
      if (route.tab === 'themes') return 'themes';
      if (route.tab === 'companion') return 'loop';
      return 'folder';
    case 'settings':
      // Settings writes the section on screen into its route; with none, it shows General.
      switch (route.section) {
        case 'backup':
          return 'settings';
        case 'data':
          return 'export';
        case 'calendar':
          return 'working-hours';
        case 'privacy':
          return 'privacy';
        case 'about':
          return 'updates';
        case 'security':
          return 'passphrase';
        default:
          return 'unlock';
      }
    case 'loop':
    case 'loopHome':
      return 'loop';
    case 'help':
      return null;
  }
}
