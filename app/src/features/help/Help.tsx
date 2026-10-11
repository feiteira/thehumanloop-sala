import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { Block, Inline } from '../../core/text/markdown';
import { useI18n } from '../../ui/i18n';
import { Field, focusRing, IconButton, Row, T, web } from '../../ui/primitives';
import { font, radius, space, type as typo, useTheme } from '../../ui/theme';
import { Highlight } from '../common/Highlight';
import { chapters, imageUrl, searchManual, TOPICS } from './manual';

/** The manual. Needs no open practice: `onBack`, when given, shows a back chevron. */
export function Help({ topic, onBack }: { topic?: string; onBack?: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const all = useMemo(() => chapters(i18n.locale), [i18n.locale]);
  const start = topic ? TOPICS[topic] : undefined;
  const [file, setFile] = useState(start?.file ?? 'index.md');
  const [anchor, setAnchor] = useState<string | null>(start?.anchor ?? null);
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchManual(i18n.locale, q), [i18n.locale, q]);
  const chapter = all.find((ch) => ch.file === file) ?? all[0];
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());
  // Each open() scrolls again, even to the section already shown and laid out.
  const [jump, setJump] = useState(0);

  const open = (f: string, a: string | null = null) => {
    // Another chapter's headings report where they are as it renders; the shown one's already have.
    if (f !== file) offsets.current.clear();
    setFile(f);
    setAnchor(a);
    setJump((n) => n + 1);
    if (!a) scroll.current?.scrollTo({ y: 0, animated: false });
  };

  // Scroll to the anchor once its heading has been laid out.
  useEffect(() => {
    if (!anchor) return;
    const timer = setInterval(() => {
      const y = offsets.current.get(anchor);
      if (y !== undefined) {
        scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
        clearInterval(timer);
      }
    }, 50);
    const stop = setTimeout(() => clearInterval(timer), 2000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [anchor, file, jump]);

  return (
    <View style={{ flex: 1, flexDirection: 'row' }} testID="screen-help">
      <View style={{ width: 280, borderRightWidth: 1, borderRightColor: c.border, padding: space.lg, gap: space.sm }}>
        <Row>
          {onBack ? (
            <View style={{ marginLeft: -space.sm }}>
              <IconButton icon="chevronLeft" label={t('common.back')} onPress={onBack} testID="screen-back" />
            </View>
          ) : null}
          <T variant="title" role="heading">{t('help.title')}</T>
        </Row>
        <Field value={q} onChangeText={setQ} placeholder={t('help.searchPlaceholder')} accessibilityLabel={t('help.searchPlaceholder')} testID="help-search" />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }}>
          {q.trim().length >= 2 ? (
            hits.length ? (
              hits.map((h, i) => (
                <NavLink key={i} active={false} onPress={() => open(h.file, h.anchor)}>
                  <T variant="label" numberOfLines={1}>{h.heading}</T>
                  {h.excerpt.text ? <Highlight excerpt={h.excerpt} variant="tiny" tone="muted" numberOfLines={2} /> : null}
                </NavLink>
              ))
            ) : (
              <T variant="small" tone="muted">{t('help.noResults', { q })}</T>
            )
          ) : (
            <>
              <T variant="label" tone="secondary" style={{ marginTop: space.sm }}>{t('help.contents')}</T>
              {all.map((ch) => (
                <NavLink key={ch.file} active={ch.file === file} onPress={() => open(ch.file)}>
                  <T variant="small" tone={ch.file === file ? 'primary' : 'secondary'}>{ch.title}</T>
                </NavLink>
              ))}
            </>
          )}
        </ScrollView>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: space.xxl, maxWidth: 820, gap: space.md }}>
        {chapter ? (
          // Keyed by chapter: a chapter's blocks are new nodes, so every heading reports where
          // it is, and a link into another chapter lands on its section.
          <Markdown
            key={chapter.file}
            blocks={chapter.blocks}
            onLink={(href) => {
              const [f, a] = href.split('#');
              if (f && f.endsWith('.md')) open(f, a ?? null);
              else if (!f && a) open(file, a);
            }}
            onAnchorLayout={(a, y) => offsets.current.set(a, y)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function NavLink({ active, onPress, children }: { active: boolean; onPress: () => void; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={(s) => [
        { padding: space.sm, borderRadius: radius.md, backgroundColor: active ? c.primarySubtle : (s as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent', gap: 2 },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {children}
    </Pressable>
  );
}

function Inlines({ c: nodes, onLink, base }: { c: Inline[]; onLink: (href: string) => void; base: object }) {
  const { c } = useTheme();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Text key={i}>{n.v}</Text>;
          case 'bold':
            return <Text key={i} style={{ fontWeight: '700' }}><Inlines c={n.c} onLink={onLink} base={base} /></Text>;
          case 'italic':
            return <Text key={i} style={{ fontStyle: 'italic' }}><Inlines c={n.c} onLink={onLink} base={base} /></Text>;
          case 'strike':
            return <Text key={i} style={{ textDecorationLine: 'line-through' }}><Inlines c={n.c} onLink={onLink} base={base} /></Text>;
          case 'code':
            return <Text key={i} style={{ fontFamily: font.mono, backgroundColor: c.surfaceAlt, fontSize: 13 }}>{n.v}</Text>;
          case 'link':
            return (
              <Text key={i} accessibilityRole="link" onPress={() => onLink(n.href)} style={[{ color: c.accentText, textDecorationLine: 'underline' }, web({ cursor: 'pointer' })]}>
                <Inlines c={n.c} onLink={onLink} base={base} />
              </Text>
            );
        }
      })}
    </>
  );
}

export function Markdown({ blocks, onLink, onAnchorLayout }: { blocks: Block[]; onLink: (href: string) => void; onAnchorLayout?: (anchor: string, y: number) => void }) {
  const { c } = useTheme();
  const body = [typo.body, { color: c.text, lineHeight: 24 }];
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading': {
            const style = b.level === 1 ? typo.display : b.level === 2 ? typo.title : typo.heading;
            return (
              <Text
                key={i}
                accessibilityRole="header"
                onLayout={b.anchor && onAnchorLayout ? (e) => onAnchorLayout(b.anchor!, e.nativeEvent.layout.y) : undefined}
                style={[style, { color: c.text, marginTop: b.level === 1 ? 0 : space.lg }]}
              >
                <Inlines c={b.c} onLink={onLink} base={body} />
              </Text>
            );
          }
          case 'para':
            return (
              <Text key={i} style={body}>
                <Inlines c={b.c} onLink={onLink} base={body} />
              </Text>
            );
          case 'code':
            return (
              <Text key={i} style={[typo.small, { fontFamily: font.mono, color: c.text, backgroundColor: c.surfaceAlt, padding: space.md, borderRadius: radius.md }]}>
                {b.v}
              </Text>
            );
          case 'rule':
            return <View key={i} style={{ height: 1, backgroundColor: c.divider, marginVertical: space.sm }} />;
          case 'quote':
            return (
              <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: space.md }}>
                <Text style={body}><Inlines c={b.c} onLink={onLink} base={body} /></Text>
              </View>
            );
          case 'list':
            return (
              <View key={i} style={{ gap: 6 }}>
                {b.items.map((it, j) => {
                  const n = b.items.slice(0, j + 1).filter((x) => x.depth === it.depth).length;
                  return (
                    <View key={j} style={{ flexDirection: 'row', gap: space.sm, paddingLeft: it.depth * 20 }}>
                      <Text style={[body, { width: 22, textAlign: 'right', color: c.textSecondary }]}>{b.ordered && it.depth === 0 ? `${n}.` : '•'}</Text>
                      <Text style={[body, { flex: 1 }]}><Inlines c={it.c} onLink={onLink} base={body} /></Text>
                    </View>
                  );
                })}
              </View>
            );
          case 'table':
            return (
              <View key={i} style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden' }}>
                {[b.head, ...b.rows].map((row, r) => (
                  <View key={r} style={{ flexDirection: 'row', backgroundColor: r === 0 ? c.surfaceAlt : c.surface, borderTopWidth: r ? 1 : 0, borderTopColor: c.divider }}>
                    {row.map((cell, k) => (
                      <Text key={k} style={[typo.small, { flex: 1, padding: space.sm, color: c.text, fontWeight: r === 0 ? '600' : '400' }]}>
                        <Inlines c={cell} onLink={onLink} base={body} />
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            );
          case 'image': {
            const uri = imageUrl(b.src);
            if (!uri) return null;
            return (
              <View key={i} style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.surfaceSunken }}>
                <Image source={{ uri }} accessibilityLabel={b.alt} style={{ width: '100%', aspectRatio: 1400 / 900 }} resizeMode="contain" />
              </View>
            );
          }
        }
      })}
    </>
  );
}
