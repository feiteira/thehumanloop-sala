import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { Excerpt } from '../../services/search';
import { T } from '../../ui/primitives';
import type { type as typo } from '../../ui/theme';
import { useTheme } from '../../ui/theme';

/**
 * Text with the words that were searched for in bold, so a search result shows why it was
 * found. Bold, not colour alone, marks them.
 */
export function Highlight({
  excerpt, variant = 'small', tone = 'secondary', numberOfLines, style,
}: {
  excerpt: Excerpt;
  variant?: keyof typeof typo;
  tone?: 'primary' | 'secondary' | 'muted';
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();
  const parts: React.ReactNode[] = [];
  let at = 0;
  excerpt.marks.forEach(([a, b], i) => {
    if (a > at) parts.push(excerpt.text.slice(at, a));
    parts.push(
      <Text key={i} style={{ fontWeight: '700', color: c.text }}>
        {excerpt.text.slice(a, b)}
      </Text>,
    );
    at = b;
  });
  if (at < excerpt.text.length) parts.push(excerpt.text.slice(at));
  return (
    <T variant={variant} tone={tone} numberOfLines={numberOfLines} style={style}>
      {parts}
    </T>
  );
}
