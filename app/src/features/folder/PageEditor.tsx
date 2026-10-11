import React, { useEffect, useRef, useState } from 'react';
import { Pressable, type TextInput, View } from 'react-native';
import { DateTime } from 'luxon';
import { uuid } from '../../core/ids';
import { folderThemes, inReadingOrder, locate, PASSAGE_MAX, rebase, settle, trimRange } from '../../core/model/passages';
import { bySectionOrder, earlierSections, isBlankPage, KNOWN_SECTIONS, pageText } from '../../core/model/sections';
import { type Page, type Passage, TEMPLATE_SECTIONS, TEMPLATES, type Template } from '../../core/model/types';
import { sectionLabel } from '../../services/labels';
import { knownThemes, rememberThemes } from '../../services/themes';
import { eraseUnused } from '../../services/trash';
import { getSetting, setSetting } from '../../services/settings';
import { usePractice, useRegisterSaver } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { DateField, TimeField } from '../../ui/DateField';
import { useI18n, type MessageKey } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Col, ConfirmDialog, Field, focusRing, IconButton, Notice, Row, Segmented, T, web } from '../../ui/primitives';
import { selectIn, selectionIn } from '../../ui/textSelection';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow, usePracticeTz } from '../common/hooks';
import { AddStickyButton, StickyCard, StickyDialog, usePeel } from '../common/Sticky';
import { Autosave, type SaveState } from './autosave';
import { AttachmentList, useAttach } from './Documents';
import { DEFAULT_TEMPLATE_SETTING, deletePage, forgetFreshPage, isFreshPage, undeletePage } from './pageActions';
import { ThemeDialog } from './ThemeDialog';
import { undoneExcept } from './undo';

type Draft = Pick<Page, 'date' | 'time' | 'duration_min' | 'template' | 'title' | 'sections' | 'process_note'> & { passages: Passage[] };

/** Words being marked with themes: new ones (`passageId` null) or a mark being changed. */
interface Marking {
  section: string;
  start: number;
  end: number;
  quote: string;
  passageId: string | null;
  themes: string[];
}

/**
 * Edits one session page. Changes are saved a moment after typing stops and whenever a field
 * is left; locking Sala or closing the window waits for the last words to be written.
 */
export function PageEditor({ page, onDeleted, focusPassage }: { page: Page; onDeleted: () => void; /** A marked passage to select in the note once open. */ focusPassage?: string }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { c } = useTheme();
  const toast = useToast();
  const peel = usePeel();
  const tz = usePracticeTz();
  const todayIso = useNow(tz).toISODate()!;
  const pageId = page.id;

  const [draft, setDraft] = useState<Draft>(() => pick(page));
  const latest = useRef(draft);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [autosave] = useState(() => new Autosave<Draft>((d) => practice.store.update('page', pageId, d), setSave));
  const flush = () => void autosave.flush();
  // Sections from an earlier template stay on screen while this page is open, even once emptied.
  const [earlier, setEarlier] = useState<string[]>(() => earlierSections(page).map((s) => s.key));
  const touched = useRef(false);

  const [durText, setDurText] = useState(page.duration_min ? String(page.duration_min) : '');
  const [showProcess, setShowProcess] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stickyDialog, setStickyDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [marking, setMarking] = useState<Marking | null>(null);
  const inputs = useRef(new Map<string, TextInput | null>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { data } = useLive(
    async (store) => ({
      stickies: await store.list('sticky', { where: "page_id = ? AND state != 'discarded'", params: [pageId], order: 'created_at' }),
      attachments: await store.list('attachment', { where: 'page_id = ?', params: [pageId], order: 'created_at' }),
    }),
    [pageId],
    ['sticky', 'attachment'],
  );
  const { data: defaultTemplate } = useLive((store) => getSetting<Template>(store, DEFAULT_TEMPLATE_SETTING, 'free'), [], ['setting']);
  // Themes to offer while words are being marked: this folder's, then the rest of the practice's.
  const { data: offered } = useLive(
    async (store) => (marking ? { pages: await store.list('page', { where: 'folder_id = ?', params: [page.folder_id] }), known: await knownThemes(store) } : null),
    [page.folder_id, marking !== null],
    ['page', 'setting'],
  );
  const { attach, busy: attaching } = useAttach(page.folder_id, pageId, t('page.attach'));

  // Leaving the page, and locking (before the database closes): write what is pending, and
  // quietly take away a page created since Sala was opened that was never written in (a "New
  // page" or "Write note" pressed and left). It was never the therapist's to delete, so it is
  // erased at once and never shows in Recently deleted.
  const held = useRef(data);
  held.current = data;
  const leave = useRef(async () => {});
  leave.current = async () => {
    await autosave.flush();
    const d = held.current;
    if (touched.current || !isFreshPage(pageId) || !isBlankPage(latest.current) || !d || d.stickies.length || d.attachments.length) return;
    forgetFreshPage(pageId);
    await eraseUnused(practice.store, 'page', [pageId]);
  };
  useRegisterSaver(() => leave.current());
  useEffect(() => () => void leave.current().catch(() => undefined), [autosave, practice, pageId]);

  function change(patch: Partial<Draft>) {
    const cur = latest.current;
    // Marked words stay marked while the text around them, or in them, is edited.
    let passages = patch.passages ?? cur.passages;
    for (const [key, text] of Object.entries(patch.sections ?? {})) passages = rebase(passages, key, cur.sections[key] ?? '', text);
    const next = { ...cur, ...patch, sections: { ...cur.sections, ...(patch.sections ?? {}) }, passages };
    latest.current = next;
    setDraft(next);
    if (!touched.current) {
      touched.current = true;
      forgetFreshPage(pageId);
    }
    autosave.change(next);
  }

  function setTemplate(template: Template) {
    const cur = latest.current;
    // Text the new template has no place for stays visible below, under "From the earlier template".
    const kept = Object.keys(cur.sections).filter((k) => (cur.sections[k] ?? '').trim() && !TEMPLATE_SECTIONS[template].includes(k));
    setEarlier((prev) => [...new Set([...prev, ...kept])]);
    change({ template });
  }

  async function makeDefaultTemplate() {
    const template = latest.current.template;
    try {
      await setSetting(practice.store, DEFAULT_TEMPLATE_SETTING, template);
      toast.show({ message: t('page.usedForNew', { template: t(`page.templates.${template}`) }) });
    } catch {
      toast.show({ message: t('errors.generic') });
    }
  }

  async function remove() {
    autosave.discard();
    const deleted = await deletePage(practice.store, pageId);
    onDeleted();
    toast.undo(t('page.deleted'), async () => undoneExcept(toast, i18n, await undeletePage(practice.store, deleted)));
  }

  /** Opens the theme dialog for the words selected in a section's box. */
  function markFrom(key: string) {
    const text = latest.current.sections[key] ?? '';
    const sel = selectionIn(inputs.current.get(key));
    // The box shows the page's text; should the two ever differ, the words are found again in the page.
    const found = sel ? (sel.text === text ? sel : locate(text, { ...sel, quote: sel.text.slice(sel.start, sel.end) })) : null;
    const range = found ? trimRange(text, found) : null;
    if (!range) {
      toast.show({ message: t('themes.selectFirst') });
      return;
    }
    if (range.end - range.start > PASSAGE_MAX) {
      toast.show({ message: t('themes.tooLong', { n: PASSAGE_MAX }) });
      return;
    }
    const same = latest.current.passages.find((p) => p.section === key && p.start === range.start && p.end === range.end);
    setMarking({ section: key, ...range, quote: text.slice(range.start, range.end), passageId: same?.id ?? null, themes: same?.themes ?? [] });
  }

  function editMark(p: Passage) {
    setMarking({ section: p.section, start: p.start, end: p.end, quote: p.quote, passageId: p.id, themes: p.themes });
  }

  function saveMark(themes: string[]) {
    const m = marking;
    if (!m) return;
    const cur = latest.current.passages;
    const passages = m.passageId
      ? cur.map((p) => (p.id === m.passageId ? { ...p, themes } : p))
      : [...cur, { id: uuid(), section: m.section, start: m.start, end: m.end, quote: m.quote, themes, created_at: new Date().toISOString() }];
    change({ passages });
    flush();
    void rememberThemes(practice.store, themes).catch(() => undefined);
  }

  function unmark() {
    const removed = latest.current.passages.find((p) => p.id === marking?.passageId);
    if (!removed) return;
    change({ passages: latest.current.passages.filter((p) => p.id !== removed.id) });
    flush();
    toast.undo(t('themes.unmarked'), async () => {
      if (mounted.current) {
        const cur = latest.current;
        change({ passages: [...cur.passages, ...settle(cur.sections, [removed])] });
        await autosave.flush();
        return;
      }
      const saved = await practice.store.get('page', pageId);
      if (saved && !saved.deleted) await practice.store.update('page', pageId, { passages: [...(saved.passages ?? []), ...settle(saved.sections, [removed])] });
    });
  }

  /** Selects a passage's words in their box. */
  const show = (p: Passage) => {
    const at = locate(latest.current.sections[p.section] ?? '', p);
    if (at) selectIn(inputs.current.get(p.section), at.start, at.end);
  };
  const showRef = useRef(show);
  showRef.current = show;
  // Opened from the Themes divider: the passage's words are selected, once the boxes have grown.
  useEffect(() => {
    const p = focusPassage ? latest.current.passages.find((x) => x.id === focusPassage) : undefined;
    if (!p) return;
    const timer = setTimeout(() => showRef.current(p), 80);
    return () => clearTimeout(timer);
  }, [focusPassage]);

  const words = pageText(draft).split(' ').filter(Boolean).length;
  const editing = stickyDialog.id ? data?.stickies.find((s) => s.id === stickyDialog.id) : null;
  const own = TEMPLATE_SECTIONS[draft.template];
  const kept = earlier.filter((k) => !own.includes(k)).sort(bySectionOrder);
  const files = data?.attachments.length ?? 0;
  const status =
    save.kind === 'pending' || save.kind === 'saving'
      ? t('common.saving')
      : save.kind === 'saved'
        ? t('page.savedAt', { time: i18n.time(DateTime.fromJSDate(save.at).setZone(tz)) })
        : '';

  const section = (key: string, minHeight: number) => {
    const label = sectionLabel(i18n, key);
    return (
      <View key={`section-${key}`} style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between', minHeight: 30 }}>
          <T variant="label" tone="secondary">{label}</T>
          {/* Only a box with words in it has anything to mark. */}
          {(draft.sections[key] ?? '').trim() ? (
            <Button
              small
              variant="ghost"
              icon="tag"
              label={t('themes.mark')}
              accessibilityLabel={t('themes.markIn', { section: label })}
              onPress={() => markFrom(key)}
              testID={`mark-theme-${key}`}
            />
          ) : null}
        </Row>
        <Field
          ref={(node) => {
            inputs.current.set(key, node);
          }}
          accessibilityLabel={label}
          placeholder={KNOWN_SECTIONS.includes(key) ? t(`page.sectionHints.${key}` as MessageKey) : undefined}
          value={draft.sections[key] ?? ''}
          onChangeText={(v) => change({ sections: { [key]: v } })}
          onBlur={flush}
          autoGrow
          minHeight={minHeight}
          testID={`page-section-${key}`}
        />
      </View>
    );
  };
  const marked = inReadingOrder(draft.passages, bySectionOrder);
  const manySections = own.length + kept.length > 1;
  const themesHere = marking && offered ? folderThemes([...offered.pages.filter((p) => p.id !== pageId), { ...page, ...draft }], bySectionOrder).map((s) => s.name) : [];

  return (
    <View style={{ gap: space.lg }} testID="page-editor">
      {page.import_provenance ? (
        <Notice tone={page.import_provenance.source_kind === 'ocr' ? 'warning' : 'info'} icon="import">
          {[
            t('page.fromImport', { source: page.import_provenance.source_name }),
            page.import_provenance.source_kind === 'ocr' ? t('page.fromScan') : '',
            page.import_provenance.confidence !== null ? t('page.confidence', { n: Math.round(page.import_provenance.confidence) }) : '',
          ].filter(Boolean).join(' ')}
        </Notice>
      ) : null}

      <Row wrap gap={space.md} align="flex-start">
        <DateField
          label={t('page.date')}
          value={draft.date}
          today={todayIso}
          required
          onChange={(iso, ok) => {
            if (iso && ok) change({ date: iso });
          }}
          onBlur={flush}
          style={{ width: 150 }}
          testID="page-date"
        />
        <TimeField
          label={t('page.time')}
          value={draft.time}
          onChange={(time, ok) => {
            if (ok) change({ time });
          }}
          onBlur={flush}
          style={{ width: 110 }}
          testID="page-time"
        />
        <Field
          label={t('page.duration')}
          value={durText}
          onChangeText={(v) => {
            const clean = v.replace(/\D/g, '').slice(0, 4);
            setDurText(clean);
            const n = Number(clean);
            change({ duration_min: clean && n > 0 && n <= 1440 ? n : null });
          }}
          onBlur={flush}
          style={{ width: 120 }}
          keyboardType="number-pad"
        />
        <View style={{ gap: space.xs, maxWidth: '100%' }}>
          <T variant="label" tone="secondary">{t('page.template')}</T>
          <Row wrap gap={space.sm}>
            <Segmented<Template>
              label={t('page.template')}
              value={draft.template}
              onChange={setTemplate}
              options={TEMPLATES.map((tpl) => ({ value: tpl, label: t(`page.templates.${tpl}`) }))}
            />
            {defaultTemplate && draft.template !== defaultTemplate && draft.template !== 'intake' ? (
              <Button small variant="ghost" label={t('page.useForNew')} onPress={() => void makeDefaultTemplate()} testID="use-template-for-new" />
            ) : null}
          </Row>
        </View>
      </Row>

      <Field label={t('page.title')} value={draft.title} onChangeText={(title) => change({ title })} onBlur={flush} placeholder={t('page.titlePlaceholder')} testID="page-title" />

      {/* A free page's one box is tall, unless kept text waits below it and should stay in sight. */}
      {own.map((key) => section(key, draft.template === 'free' && !kept.length ? 320 : 120))}

      {kept.length ? (
        <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: space.md }} testID="earlier-sections">
          <Col gap={2}>
            <T variant="label" tone="secondary" role="heading">{t('page.earlierTemplate')}</T>
            <T variant="small" tone="muted">{t('page.earlierTemplateHint')}</T>
          </Col>
          {kept.map((key) => section(key, 96))}
        </View>
      ) : null}

      {marked.length ? (
        <Col gap={space.sm}>
          <T variant="label" tone="secondary" role="heading">{t('themes.onPage')}</T>
          <View style={{ gap: space.sm }} testID="page-themes">
            {marked.map((p) => (
              <PassageItem
                key={p.id}
                passage={p}
                gone={!locate(draft.sections[p.section] ?? '', p)}
                sectionName={manySections ? sectionLabel(i18n, p.section) : null}
                onShow={() => show(p)}
                onEdit={() => editMark(p)}
              />
            ))}
          </View>
        </Col>
      ) : null}

      <View style={{ borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, padding: space.md, gap: space.sm, backgroundColor: showProcess ? c.surfaceSunken : 'transparent' }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            <Icon name="eyeOff" size={16} color={c.textSecondary} />
            <T variant="label" tone="secondary">{t('page.processNote')}</T>
            {!showProcess && draft.process_note.trim() ? <T variant="tiny" tone="muted">•</T> : null}
          </Row>
          <Button small variant="ghost" label={showProcess ? t('page.hideProcessNote') : t('page.showProcessNote')} onPress={() => setShowProcess(!showProcess)} testID="toggle-process-note" />
        </Row>
        {showProcess ? (
          <>
            <T variant="small" tone="muted">{t('page.processNoteHint')}</T>
            <Field value={draft.process_note} onChangeText={(v) => change({ process_note: v })} onBlur={flush} autoGrow minHeight={110} accessibilityLabel={t('page.processNote')} testID="page-process-note" />
          </>
        ) : null}
      </View>

      <Col gap={space.sm}>
        <T variant="label" tone="secondary">{t('page.stickies')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {data?.stickies.map((s) => (
            <StickyCard key={s.id} sticky={s} onEdit={() => setStickyDialog({ open: true, id: s.id })} onPeel={() => void peel(s)} />
          ))}
          <AddStickyButton label={t('folder.addNote')} onPress={() => setStickyDialog({ open: true, id: null })} />
        </View>
      </Col>

      <Col gap={space.sm}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="label" tone="secondary">{t('page.attachments')}</T>
          <Button small icon="paperclip" label={t('page.attach')} onPress={attach} busy={attaching} testID="attach-file" />
        </Row>
        <AttachmentList items={data?.attachments ?? []} />
      </Col>

      <Row style={{ justifyContent: 'space-between' }} wrap>
        <Row gap={space.xs} style={{ flexShrink: 1 }}>
          <T variant="tiny" tone="muted">{tp('page.wordCount', words)}</T>
          {status ? (
            <View testID="page-save-status">
              <T variant="tiny" tone="muted">· {status}</T>
            </View>
          ) : null}
          {/* Only a failure is announced; "Saving…" and "Saved" would be read every few seconds. */}
          <View aria-live="polite">
            {save.kind === 'failed' ? (
              <Row gap={space.xs}>
                <Icon name="alert" size={14} color={c.dangerText} />
                <T variant="tiny" tone="danger">{t('page.notSaved')}</T>
                <Button small variant="ghost" label={t('common.retry')} onPress={flush} testID="page-save-retry" />
              </Row>
            ) : null}
          </View>
        </Row>
        <Button small variant="ghost" icon="trash" label={t('page.delete')} onPress={() => setConfirmDelete(true)} testID="delete-page" />
      </Row>

      <ThemeDialog
        visible={!!marking}
        quote={marking?.quote ?? ''}
        initial={marking?.themes ?? NO_THEMES}
        inFolder={themesHere}
        elsewhere={offered?.known ?? NO_THEMES}
        editing={!!marking?.passageId}
        onSave={saveMark}
        onUnmark={unmark}
        onClose={() => setMarking(null)}
      />
      <StickyDialog visible={stickyDialog.open} onClose={() => setStickyDialog({ open: false, id: null })} folderId={page.folder_id} pageId={page.id} sticky={editing} />
      <ConfirmDialog
        visible={confirmDelete}
        title={t('page.deleteTitle')}
        message={[t('page.deleteBody'), files ? tp('page.deleteFilesMove', files) : ''].filter(Boolean).join(' ')}
        confirmLabel={t('common.delete')}
        danger
        width={420}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        testID="confirm-delete-page"
      />
    </View>
  );
}

function pick(p: Page): Draft {
  return {
    date: p.date, time: p.time, duration_min: p.duration_min, template: p.template, title: p.title, sections: { ...p.sections }, process_note: p.process_note,
    passages: settle(p.sections, p.passages ?? []),
  };
}

const NO_THEMES: string[] = [];

/** One marked passage under the note: its words (select them in the note) and its themes. */
function PassageItem({ passage, gone, sectionName, onShow, onEdit }: { passage: Passage; gone: boolean; sectionName: string | null; onShow: () => void; onEdit: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const words = passage.quote.replace(/\s+/g, ' ').trim();
  const brief = words.length > 80 ? `${words.slice(0, 80)}…` : words;
  return (
    <View testID="page-passage" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <Pressable
        onPress={onShow}
        disabled={gone}
        accessibilityRole="button"
        accessibilityLabel={t('themes.show', { quote: brief })}
        style={(s) => [
          { flex: 1, gap: 4, borderLeftWidth: 3, borderLeftColor: gone ? c.border : c.accent, paddingLeft: space.md, paddingVertical: 2, borderRadius: 2 },
          (s as { hovered?: boolean }).hovered && !gone && { backgroundColor: c.surfaceAlt },
          (s as { focused?: boolean }).focused && focusRing(c.focus),
          web({ cursor: gone ? 'default' : 'pointer' }),
        ]}
      >
        <T numberOfLines={3} tone={gone ? 'muted' : 'primary'} style={{ fontStyle: 'italic' }}>{words}</T>
        <Row wrap gap={space.xs}>
          {passage.themes.map((n) => (
            <Badge key={n} tone="info" label={n} />
          ))}
          {sectionName ? <T variant="tiny" tone="muted">{sectionName}</T> : null}
          {gone ? <T variant="tiny" tone="muted">{t('themes.gone')}</T> : null}
        </Row>
      </Pressable>
      <IconButton icon="edit" size={32} label={t('themes.change', { quote: brief })} onPress={onEdit} testID="edit-passage" />
    </View>
  );
}
