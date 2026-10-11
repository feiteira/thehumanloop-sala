import React from 'react';
import { Text, View } from 'react-native';
import { useI18n } from '../ui/i18n';
import { useTheme } from '../ui/theme';

// A small diagonal "BETA" band across the bottom-left corner, mounted once at the root so it
// shows on every screen, onboarding and unlock included.
//
// Bottom-left is the corner with nothing under it: the sidebar holds the Sala mark top-left
// and the backup line just above the corner, the screens put Help and their actions top-right,
// and pages and the calendar scroll to the bottom-right. If a layout change puts a control
// here, move the ribbon, not the control.
//
// Furniture, not meaning: the brand's ink tile (ink / onInk), never the burnt yellow. It
// never takes a click, sits below every dialog (they open in their own layer) and is hidden
// from screen readers, which hear "Beta version" once instead.

const BAND = 20; // band thickness
const CENTRE = 38; // where the band's centre line meets each edge, measured from the corner
const LENGTH = 110; // band length before the box clips it
const BOX = 56; // clipping box; > CENTRE + BAND / √2 so the band's outer edge stays whole

export function BetaRibbon() {
  const { t } = useI18n();
  const { c } = useTheme();
  return (
    <View testID="beta-ribbon" style={{ position: 'absolute', left: 0, bottom: 0, width: BOX, height: BOX, overflow: 'hidden', pointerEvents: 'none', zIndex: 15 }}>
      <Text style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}>{t('app.betaVersion')}</Text>
      <View
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={{
          position: 'absolute',
          left: CENTRE / 2 - LENGTH / 2,
          bottom: CENTRE / 2 - BAND / 2,
          width: LENGTH,
          height: BAND,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.ink,
          opacity: 0.92,
          transform: [{ rotate: '45deg' }],
        }}
      >
        <Text
          selectable={false}
          style={{ color: c.onInk, fontSize: 11, lineHeight: BAND, fontWeight: '700', letterSpacing: 1.3, paddingLeft: 1.3 /* balances the trailing letter-spacing */ }}
        >
          {t('app.beta')}
        </Text>
      </View>
    </View>
  );
}
