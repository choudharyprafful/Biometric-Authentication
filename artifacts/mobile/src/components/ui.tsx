import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Animated,
  StyleSheet,
  type TextInputProps,
  type PressableProps,
  type ViewProps,
} from 'react-native';
import { colors, fonts } from '../theme';

// Sharp (non-rounded) corners everywhere, uppercase tracked mono labels, and
// bordered "terminal/HUD" cards — mirrors artifacts/secureai/src/components/ui.tsx
// so the mobile app reads as the same product as the web app rather than a
// differently-branded one that happens to share a backend.

export function CornerAccents({ color = colors.primary }: { color?: string }) {
  const size = 14;
  const thickness = 1.5;
  const base = { position: 'absolute' as const, width: size, height: size, borderColor: color };
  return (
    <>
      <View style={[base, { top: 0, left: 0, borderTopWidth: thickness, borderLeftWidth: thickness }]} />
      <View style={[base, { top: 0, right: 0, borderTopWidth: thickness, borderRightWidth: thickness }]} />
      <View style={[base, { bottom: 0, left: 0, borderBottomWidth: thickness, borderLeftWidth: thickness }]} />
      <View style={[base, { bottom: 0, right: 0, borderBottomWidth: thickness, borderRightWidth: thickness }]} />
    </>
  );
}

export function Card({
  style,
  children,
  accentCorners,
  topAccent,
  ...props
}: ViewProps & { accentCorners?: boolean; topAccent?: boolean }) {
  return (
    <View
      style={[
        styles.card,
        topAccent && { borderTopWidth: 3, borderTopColor: colors.primary },
        style,
      ]}
      {...props}
    >
      {accentCorners && <CornerAccents />}
      {children}
    </View>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.mutedForeground} style={[styles.input, props.style]} {...props} />;
}

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'default' | 'sm';

export function Button({
  children,
  onPress,
  isLoading,
  disabled,
  variant = 'default',
  size = 'default',
  style,
  ...props
}: PressableProps & { children: React.ReactNode; isLoading?: boolean; variant?: ButtonVariant; size?: ButtonSize }) {
  const variantStyle = buttonVariants[variant];
  const isDisabled = disabled || isLoading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.button, size === 'sm' && styles.buttonSm, variantStyle.button, isDisabled && { opacity: 0.5 }, style]}
      {...props}
    >
      {isLoading ? (
        <ActivityIndicator color={variantStyle.text.color as string} />
      ) : (
        <Text style={[styles.buttonText, size === 'sm' && styles.buttonTextSm, variantStyle.text]}>{children}</Text>
      )}
    </Pressable>
  );
}

type BadgeTone = 'primary' | 'destructive' | 'success' | 'warning' | 'info' | 'outline';

export function Badge({ children, tone = 'outline' }: { children: React.ReactNode; tone?: BadgeTone }) {
  const color = tone === 'outline' ? colors.mutedForeground : colors[tone];
  return (
    <View style={[styles.badge, { borderColor: tone === 'outline' ? colors.border : `${color}66`, backgroundColor: tone === 'outline' ? 'transparent' : `${color}1A` }]}>
      <Text style={[styles.badgeText, { color }]}>{children}</Text>
    </View>
  );
}

export function StatCard({ label, value, tone = 'primary' }: { label: string; value: string | number; tone?: BadgeTone }) {
  const color = tone === 'outline' ? colors.foreground : colors[tone];
  return (
    <Card style={styles.statCard} topAccent>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </Card>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function SectionNote({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'destructive' }) {
  const color = tone === 'destructive' ? colors.destructive : colors.primary;
  return (
    <View style={[styles.sectionNote, { borderColor: `${color}55`, backgroundColor: `${color}0D` }]}>
      <Text style={[styles.sectionNoteText, { color }]}>{children}</Text>
    </View>
  );
}

export function ShieldBadge({ size = 64 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const inner = size * 0.4;
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderWidth: 1,
        borderColor: `${colors.primary}4D`,
        backgroundColor: `${colors.primary}1A`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pulse,
      }}
    >
      <View style={{ width: inner, height: inner, borderWidth: 1.5, borderColor: colors.primary }} />
    </Animated.View>
  );
}

const buttonVariants: Record<ButtonVariant, { button: any; text: any }> = {
  default: {
    button: { backgroundColor: colors.primary },
    text: { color: colors.primaryForeground },
  },
  outline: {
    button: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
    text: { color: colors.primary },
  },
  ghost: {
    button: { backgroundColor: 'transparent' },
    text: { color: colors.mutedForeground },
  },
  destructive: {
    button: { backgroundColor: colors.destructive },
    text: { color: '#1a0508' },
  },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    position: 'relative',
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: colors.mutedForeground,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  buttonSm: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  buttonText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  buttonTextSm: {
    fontSize: 10,
    letterSpacing: 1,
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statCard: {
    flexBasis: '48%',
    padding: 14,
    marginBottom: 12,
  },
  statLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.mutedForeground,
    marginBottom: 6,
  },
  statValue: {
    fontFamily: fonts.mono,
    fontSize: 26,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  sectionNote: {
    borderWidth: 1,
    padding: 12,
  },
  sectionNoteText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
