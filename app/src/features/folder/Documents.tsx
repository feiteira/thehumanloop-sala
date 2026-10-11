import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { DateTime } from 'luxon';
import { toBase64 } from '../../core/bytes';
import { type Attachment, MAX_DOCUMENT_BYTES } from '../../core/model/types';
import { baseName, formatSize, isPreviewableImage, mimeOf } from '../../core/text/mime';
import { isLocked } from '../../services/practice';
import { useAppState, useLockAwareJob, usePractice } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, IconButton, Notice, Row, T } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { type AttachResult, attachMessage } from './format';
import { sessionNumbers } from './pageActions';

/**
 * Attaches files to the folder (or to one of its pages). Never throws. Once `shouldStop` says
 * yes (Sala is locking), the files not yet added are left out.
 */
export async function attachFiles(
  practice: ReturnType<typeof usePractice>,
  platform: ReturnType<typeof useAppState>['platform'],
  paths: string[],
  target: { folderId: string; pageId: string | null },
  shouldStop: () => boolean = () => !practice.isOpen,
): Promise<AttachResult> {
  const result: AttachResult = { added: 0, tooLarge: 0, failed: 0 };
  for (const path of paths) {
    if (shouldStop()) break;
    try {
      const bytes = await platform.files.read(path);
      if (bytes.length > MAX_DOCUMENT_BYTES) {
        result.tooLarge++;
        continue;
      }
      if (shouldStop()) break;
      const filename = baseName(path);
      await practice.addAttachment(bytes, { folder_id: target.folderId, page_id: target.pageId, filename, mime: mimeOf(filename), local_only: false, source: 'upload', ocr_text: null });
      result.added++;
    } catch (e) {
      if (isLocked(e)) break;
      console.error(e);
      result.failed++;
    }
  }
  return result;
}

/**
 * Asks for files and attaches them, with a busy button and a short report when done. While the
 * files are being added, Sala does not lock itself; locking stops it between files.
 */
export function useAttach(folderId: string, pageId: string | null, title: string): { attach: () => void; busy: boolean } {
  const practice = usePractice();
  const { platform, noteStopped } = useAppState();
  const i18n = useI18n();
  const toast = useToast();
  const job = useLockAwareJob();
  const [busy, setBusy] = useState(false);
  const attach = () => {
    if (busy || job.shouldStop()) return;
    setBusy(true);
    void (async () => {
      let paths: string[];
      try {
        paths = await platform.dialogs.pickFiles(title, [], true);
      } catch (e) {
        console.error(e);
        paths = [];
        toast.show({ message: attachMessage(i18n, { added: 0, tooLarge: 0, failed: 1 })! });
      }
      if (!paths.length) return;
      // Sala locked while the files were being chosen, or added: the unlock screen says how
      // many were left out.
      if (job.shouldStop()) return noteStopped({ kind: 'documents', count: paths.length });
      const r = await job.run((shouldStop) => attachFiles(practice, platform, paths, { folderId, pageId }, shouldStop));
      if (job.shouldStop()) return noteStopped({ kind: 'documents', count: paths.length - r.added - r.tooLarge - r.failed });
      const message = attachMessage(i18n, r);
      if (message) toast.show({ message });
    })()
      .catch((e) => console.error(e))
      .finally(() => setBusy(false));
  };
  return { attach, busy };
}

export function AttachmentList({ items, pageLabels }: { items: Attachment[]; pageLabels?: Map<string, string> }) {
  const { c } = useTheme();
  const i18n = useI18n();
  const { t } = i18n;
  const practice = usePractice();
  const { platform } = useAppState();
  const toast = useToast();
  const [preview, setPreview] = useState<{ att: Attachment; uri: string } | null>(null);
  const [confirm, setConfirm] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(att: Attachment) {
    setError(null);
    try {
      const bytes = await practice.readAttachment(att);
      if (isPreviewableImage(att.mime)) setPreview({ att, uri: `data:${att.mime};base64,${toBase64(bytes)}` });
      else await saveCopy(att, bytes);
    } catch {
      setError(t('errors.fileRead'));
    }
  }

  async function saveCopy(att: Attachment, bytes?: Uint8Array) {
    try {
      const path = await platform.dialogs.saveFile(t('common.save'), att.filename, []);
      if (!path) return;
      await platform.files.write(path, bytes ?? (await practice.readAttachment(att)));
    } catch {
      setError(t('errors.fileWrite'));
    }
  }

  async function remove(att: Attachment) {
    // A tombstone only: the file stays on disk until the delete is final, so Undo can bring it back.
    await practice.store.remove('attachment', [att.id]);
    toast.undo(t('folder.documentDeleted'), () => practice.store.restore('attachment', [att.id]));
  }

  return (
    <View style={{ gap: space.sm }}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {items.map((a) => {
        const image = isPreviewableImage(a.mime);
        return (
          <Row key={a.id} style={{ padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
            <Icon name={a.mime.startsWith('image/') ? 'image' : 'file'} size={18} color={c.textSecondary} />
            <View style={{ flex: 1 }}>
              <T variant="small" numberOfLines={1}>{a.filename}</T>
              <T variant="tiny" tone="muted">
                {formatSize(a.size, i18n.meta.bcp47)}
                {a.page_id && pageLabels?.get(a.page_id) ? ` · ${pageLabels.get(a.page_id)}` : ''}
              </T>
            </View>
            <IconButton
              icon={image ? 'eye' : 'download'}
              label={image ? t('folder.documentOpen', { name: a.filename }) : t('folder.documentSave', { name: a.filename })}
              onPress={() => void open(a)}
            />
            <IconButton icon="trash" label={t('folder.documentDelete', { name: a.filename })} onPress={() => setConfirm(a)} />
          </Row>
        );
      })}
      <Dialog visible={!!preview} title={preview?.att.filename ?? ''} onClose={() => setPreview(null)} width={900} footer={preview ? <Button icon="download" label={t('common.save')} onPress={() => { const p = preview; void saveCopy(p.att); }} /> : undefined}>
        {preview ? (
          <View style={{ gap: space.sm }}>
            {preview.att.ocr_text ? <Notice tone="warning">{t('page.fromScan')}</Notice> : null}
            <Image source={{ uri: preview.uri }} style={{ width: '100%', height: 620 }} resizeMode="contain" accessibilityLabel={preview.att.filename} />
          </View>
        ) : null}
      </Dialog>
      <ConfirmDialog
        visible={!!confirm}
        title={t('folder.documentDeleteTitle')}
        message={confirm?.filename ?? ''}
        confirmLabel={t('common.delete')}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm ? remove(confirm) : undefined)}
        testID="confirm-delete-document"
      />
    </View>
  );
}

/** The Documents divider: every file in the folder, newest first, with the session it belongs to. */
export function Documents({ folderId }: { folderId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { data } = useLive(
    async (store) => {
      const pages = await store.list('page', { where: 'folder_id = ?', params: [folderId] });
      const numbers = sessionNumbers(pages);
      return {
        items: await store.list('attachment', { where: 'folder_id = ?', params: [folderId], order: 'created_at DESC' }),
        pages: new Map(pages.map((p) => [p.id, `${t('page.session', { n: numbers.get(p.id) ?? 0 })} · ${i18n.date(DateTime.fromISO(p.date), 'medium')}`])),
      };
    },
    [folderId, i18n],
    ['attachment', 'page'],
  );
  const { attach, busy } = useAttach(folderId, null, t('folder.addDocument'));
  if (data && data.items.length === 0) {
    return <EmptyState icon="paperclip" title={t('folder.noDocuments')} body={t('folder.noDocumentsBody')} action={<Button icon="plus" label={t('folder.addDocument')} onPress={attach} busy={busy} testID="add-document" />} />;
  }
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button icon="plus" small label={t('folder.addDocument')} onPress={attach} busy={busy} testID="add-document" />
      </Row>
      <AttachmentList items={data?.items ?? []} pageLabels={data?.pages} />
    </Card>
  );
}
