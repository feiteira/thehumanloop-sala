// The manual's screenshots. Each is taken in en, pt and es from the browser demo (a
// fictional practice), with a fixed clock: Monday 28 September 2026, 09:00, Lisbon.
// A screen is addressed by name; if a step cannot find what it needs, the run fails.

export const PASSPHRASE = { en: 'violet river morning tea', pt: 'rio violeta chá da manhã', es: 'violeta río mañana té' };

const WORDS = {
  find: { en: 'sleep', pt: 'sono', es: 'sueño' },
  search: { en: 'sleep diary', pt: 'diário sono', es: 'diario sueño' },
  weekly: { en: 'Every week', pt: 'Todas as semanas', es: 'Cada semana' },
  freeText: { en: 'Free text', pt: 'Texto livre', es: 'Texto libre' },
  mark: { en: 'Kept the sleep diary for 5 of 7 days.', pt: 'Preencheu o diário do sono em 5 de 7 dias.', es: 'Rellenó el diario de sueño 5 de 7 días.' },
  protect: { en: 'Protect the file with a password', pt: 'Proteger o ficheiro com palavra-passe', es: 'Proteger el archivo con contraseña' },
};

export const SHOTS = [
  { name: 'welcome', query: 'demo=empty' },
  {
    name: 'passphrase',
    query: 'demo=empty',
    steps: async (page, lang) => {
      await page.getByTestId('start-new').click();
      await page.getByTestId('passphrase').fill(PASSPHRASE[lang]);
      await page.getByTestId('passphrase-confirm').fill(PASSPHRASE[lang]);
    },
  },
  {
    name: 'recovery-phrase',
    query: 'demo=empty',
    steps: async (page, lang) => {
      await page.getByTestId('start-new').click();
      await page.getByTestId('passphrase').fill(PASSPHRASE[lang]);
      await page.getByTestId('passphrase-confirm').fill(PASSPHRASE[lang]);
      await page.getByTestId('next').click();
      await page.getByTestId('recovery-phrase').waitFor();
    },
  },
  { name: 'unlock', query: 'route=locked' },
  {
    name: 'quick-open',
    query: 'route=today',
    ready: 'screen-today',
    steps: async (page, lang) => {
      await page.keyboard.press('Control+k');
      await page.getByTestId('quick-open').waitFor();
      await page.getByTestId('quick-open-input').fill(WORDS.find[lang]);
      await page.getByTestId('quick-open-f-00000000-0000-4000-8000-000000000001').waitFor();
    },
  },
  { name: 'today', query: 'route=today', ready: 'screen-today' },
  { name: 'backup-failed', query: 'route=today&backup=failed', ready: 'backup-notice' },
  { name: 'shelf', query: 'route=shelf', ready: 'screen-shelf' },
  {
    name: 'shelf-search',
    query: 'route=shelf',
    ready: 'screen-shelf',
    steps: async (page, lang) => {
      await page.getByTestId('shelf-search').fill(WORDS.search[lang]);
      await page.getByTestId('hit-group-Inês Salgado').waitFor();
    },
  },
  { name: 'folder', query: 'route=folder:1', ready: 'page-editor' },
  {
    name: 'earlier-template',
    query: 'route=folder:1',
    ready: 'page-editor',
    steps: async (page, lang) => {
      await page.getByTestId('page-editor').getByRole('radio', { name: WORDS.freeText[lang], exact: true }).click();
      await page.getByTestId('earlier-sections').waitFor();
    },
  },
  { name: 'themes', query: 'route=folder:1:themes', ready: 'themes-overview' },
  {
    // Words selected in the latest page's Data box, then Mark theme.
    name: 'theme-mark',
    query: 'route=folder:1',
    ready: 'page-editor',
    steps: async (page, lang) => {
      const box = page.getByTestId('page-section-data');
      await box.evaluate((el, words) => {
        const at = el.value.indexOf(words);
        el.focus();
        el.setSelectionRange(at, at + words.length);
      }, WORDS.mark[lang]);
      await page.getByTestId('mark-theme-data').click();
      await page.getByTestId('theme-dialog').waitFor();
      await page.getByTestId('theme-in-folder').waitFor();
    },
  },
  {
    name: 'archive-dialog',
    query: 'route=folder:1',
    ready: 'page-editor',
    steps: async (page) => {
      await page.getByTestId('archive-folder').click();
      await page.getByTestId('archive-dialog').waitFor();
    },
  },
  {
    name: 'export-folder',
    query: 'route=folder:1',
    ready: 'page-editor',
    steps: async (page) => {
      await page.getByTestId('export-folder').click();
      await page.getByTestId('export-folder-dialog').waitFor();
    },
  },
  {
    name: 'sticky',
    query: 'route=folder:1',
    steps: async (page) => {
      await page.getByTestId('cover-sticky').first().click();
      await page.getByTestId('sticky-dialog').waitFor();
    },
  },
  { name: 'calendar', query: 'route=calendar', ready: 'screen-calendar' },
  {
    name: 'appointment',
    query: 'route=calendar',
    steps: async (page) => {
      await page.getByTestId('calendar-event').first().click();
      await page.getByTestId('appointment-dialog').waitFor();
    },
  },
  {
    // A clash and a time outside working hours: warnings under the date, never blocking.
    name: 'appointment-warning',
    query: 'route=calendar',
    ready: 'screen-calendar',
    steps: async (page, lang) => {
      await page.getByTestId('new-appointment').click();
      await page.getByTestId('appointment-dialog').waitFor();
      await page.getByTestId('folder-select').click();
      await page.getByTestId('folder-option-Beatriz Nunes').click();
      await page.getByTestId('appointment-date').fill('28/09/2026');
      await page.getByTestId('appointment-time').fill('10:45');
      await page.getByTestId('appointment-dialog').getByRole('radio', { name: WORDS.weekly[lang], exact: true }).click();
      await page.getByTestId('appointment-warnings').getByText(/\S/).first().waitFor();
    },
  },
  {
    // One date of a fortnightly series moved: Save asks which dates.
    name: 'series-choice',
    query: 'route=calendar',
    ready: 'screen-calendar',
    steps: async (page) => {
      await page.getByTestId('calendar-event').filter({ hasText: 'Carlos Duarte' }).first().click();
      await page.getByTestId('appointment-dialog').waitFor();
      await page.getByTestId('appointment-date').fill('02/10/2026');
      await page.getByTestId('appointment-time').fill('11:00');
      await page.getByTestId('appointment-time').blur();
      await page.getByTestId('save-appointment').click();
      await page.getByTestId('series-scope').waitFor();
    },
  },
  { name: 'settings-calendar', query: 'route=settings:calendar', ready: 'screen-settings' },
  { name: 'import', query: 'route=import', ready: 'screen-import' },
  {
    name: 'import-review',
    query: 'route=import',
    steps: async (page, _lang, { loadFixtures }) => {
      await loadFixtures();
      await page.evaluate(() => window.__salaDemo.queueAnswer('/home/demo/import/Pacientes'));
      await page.getByTestId('import-folder-tree').click();
      await page.getByTestId('run-import').waitFor({ timeout: 120000 });
    },
  },
  {
    name: 'import-csv',
    query: 'route=import',
    ready: 'screen-import',
    steps: async (page, _lang, { loadFixtures }) => {
      await loadFixtures();
      await page.evaluate(() => window.__salaDemo.queueAnswer('/home/demo/import/pacientes.csv'));
      await page.getByTestId('import-csv').click();
      await page.getByTestId('csv-next').waitFor();
    },
  },
  {
    name: 'import-ics',
    query: 'route=import',
    ready: 'screen-import',
    steps: async (page, _lang, { loadFixtures }) => {
      await loadFixtures();
      await page.evaluate(() => window.__salaDemo.queueAnswer('/home/demo/import/calendario.ics'));
      await page.getByTestId('import-ics').click();
      await page.getByTestId('import-event-folder').first().waitFor();
    },
  },
  {
    name: 'folder-picture',
    query: 'route=folder:1',
    steps: async (page) => {
      await page.getByTestId('folder-picture').click();
      await page.getByTestId('picture-choose').click();
      await page.getByTestId('portrait-picker').waitFor();
      await page.getByTestId('portrait-picker').getByRole('radio').nth(1).click();
    },
  },
  { name: 'settings-backup', query: 'route=settings:backup', ready: 'screen-settings' },
  { name: 'recently-deleted', query: 'route=settings:data&deleted=1', ready: 'recently-deleted' },
  {
    // Sala's own export, opened again: what is in it, before anything is added.
    name: 'import-preview',
    query: 'route=settings:data',
    ready: 'screen-settings',
    steps: async (page, lang) => {
      await page.getByText(WORDS.protect[lang], { exact: true }).click();
      await page.evaluate(() => window.__salaDemo.queueAnswer('/demo/exports/plain.sala'));
      await page.getByTestId('export').click();
      await page.getByTestId('screen-settings').getByText('/demo/exports/plain.sala').waitFor();
      await page.evaluate(() => window.__salaDemo.queueAnswer('/demo/exports/plain.sala'));
      await page.getByTestId('import-sala').click();
      await page.getByTestId('import-sala-confirm').waitFor();
    },
  },
  { name: 'settings-updates', query: 'route=settings:about&updates=on&latest=0.4.0', ready: 'updates-download' },
  { name: 'privacy', query: 'route=settings:privacy', ready: 'screen-settings' },
];
