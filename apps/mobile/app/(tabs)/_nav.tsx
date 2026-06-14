/* ============================================================
   YUMMY OR NOT — AppNav (responsive tab bar / sidebar)
   Custom `tabBar` for the <Tabs> navigator. Renders the web AppShell
   chrome with native primitives:
     • wide  (gtMd) → left-docked Sidebar (logo, LangSwitcher, nav,
                       "Log a taste" CTA, user footer)
     • narrow       → bottom TabBar with a raised center FAB ("Add")

   Routing is driven by the navigation state passed in by <Tabs>; tapping
   a nav item navigates to that route. The routes map to the shell
   sections: index→Library, add (FAB), todo, you. (Recall is folded into
   Library — searching inside 口味 surfaces past verdicts.)

   The matching screen content is rendered by <Tabs> above this chrome.
   On wide layouts the Sidebar is absolutely docked to the left; the
   route wrappers (Screen) add SIDEBAR_W left padding on gtMd so content
   clears the sidebar gutter.
   ============================================================ */

import { type ComponentProps, useCallback, useEffect, useRef } from 'react'
import {
  Pressable,
  View,
  useWindowDimensions,
  type View as RNView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { Text, colors, radius } from '@/theme'
import { LANGS } from '@yon/shared'

import { router, Tabs } from 'expo-router'
import { Avatar, Button, Icon, LangSwitcher } from '@/components/ds'
import { useI18n } from '@/providers/I18nProvider'
import { useAddTransition } from '@/providers/AddTransitionProvider'

// The render-prop param type, derived from <Tabs> so we never depend on a
// deep @react-navigation internal path.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

// Width of the desktop sidebar — matches the web AppShell aside (236px).
const SIDEBAR_W = 236

interface NavMeta {
  /** route name as registered in (tabs)/_layout */
  route: string
  icon: string
  /** i18n key for the label */
  labelKey: string
}

// Ordered to match the shell. `add` is handled separately (FAB/CTA).
// Recall folded into Library (search inside 口味). The bar is now
// Library + To-Try left of the FAB, Nearby + You to its right.
const NAV: NavMeta[] = [
  { route: 'index', icon: 'grid', labelKey: 'my_tastes' },
  { route: 'todo', icon: 'bookmark', labelKey: 'nav_todo' },
  { route: 'nearby', icon: 'map', labelKey: 'nav_nearby' },
  { route: 'you', icon: 'user', labelKey: 'nav_you' },
]

/** Map a route name to its index in the navigator state (for active check). */
function useNav(props: TabBarProps) {
  const { state, navigation } = props
  const activeRoute = state.routes[state.index]?.name
  const go = (route: string) => {
    const target = state.routes.find((r) => r.name === route)
    if (!target) return
    const event = navigation.emit({
      type: 'tabPress',
      target: target.key,
      canPreventDefault: true,
    })
    if (!event.defaultPrevented) {
      navigation.navigate(route)
    }
  }
  return { activeRoute, go }
}

/* ------------------------------------------------------------------ */
/*  Sidebar (wide / desktop)                                           */
/* ------------------------------------------------------------------ */
function Sidebar({ props }: { props: TabBarProps }) {
  const { t, lang, setLang } = useI18n()
  const { activeRoute, go } = useNav(props)
  const insets = useSafeAreaInsets()
  const { fabLayout } = useAddTransition()
  const showGlobalLangSwitcher = activeRoute !== 'you'

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: SIDEBAR_W,
        backgroundColor: colors.white,
        borderRightWidth: 3,
        borderRightColor: colors.ink900,
        paddingTop: 18 + insets.top,
        paddingBottom: 18 + insets.bottom,
        paddingHorizontal: 18,
        gap: 6,
      }}
    >
      {/* logo */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 6,
          paddingBottom: 14,
        }}
      >
        <Text style={{ fontWeight: '700', fontSize: 19, lineHeight: 19, color: colors.ink900 }}>
          yummy <Text style={{ color: colors.candyPink }}>or</Text> not
        </Text>
      </View>

      {/* lang switcher */}
      {showGlobalLangSwitcher ? (
        <View style={{ paddingHorizontal: 2, paddingBottom: 14 }}>
          <LangSwitcher
            value={lang}
            onChange={setLang}
            languages={LANGS}
            align="left"
            tone={colors.candyPink}
          />
        </View>
      ) : null}

      {/* nav items */}
      {NAV.map((n) => {
        const on = activeRoute === n.route
        return (
          <Pressable
            key={n.route}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => go(n.route)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              paddingVertical: 11,
              paddingHorizontal: 14,
              borderRadius: radius.md,
              borderWidth: 3,
              borderColor: on ? colors.ink900 : 'transparent',
              backgroundColor: on ? colors.candyYellow : 'transparent',
              ...(on
                ? {
                    shadowColor: colors.ink900,
                    shadowOffset: { width: 3, height: 3 },
                    shadowOpacity: 1,
                    shadowRadius: 0,
                  }
                : null),
            }}
          >
            <Icon name={n.icon} size={20} color="#191017" />
            <Text style={{ fontWeight: '600', fontSize: 15, color: colors.ink900 }}>
              {t(n.labelKey)}
            </Text>
          </Pressable>
        )
      })}

      <View style={{ flex: 1 }} />

      {/* log a taste CTA */}
      <Button
        variant="primary"
        block
        onPress={() => { fabLayout.value = null; router.push('/add') }}
        iconLeft={<Icon name="plus" size={18} color="#fff" />}
      >
        {t('log_taste')}
      </Button>

      {/* user footer */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginTop: 14,
          paddingTop: 10,
          paddingHorizontal: 6,
          borderTopWidth: 2,
          borderTopColor: colors.ink200,
        }}
      >
        <Avatar name="Mina Park" size="sm" />
        <View>
          <Text style={{ fontWeight: '700', fontSize: 14, color: colors.ink900 }}>
            Mina Park
          </Text>
          <Text style={{ fontSize: 12, color: colors.ink500 }}>
            {t('free_plan')}
          </Text>
        </View>
      </View>
    </View>
  )
}

/* ------------------------------------------------------------------ */
/*  Animated tab icon (scale bounce on active change)                   */
/* ------------------------------------------------------------------ */
const TAB_SPRING = { damping: 12, stiffness: 180 }

function AnimatedTab({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean
  icon: string
  label: string
  onPress: () => void
}) {
  const scale = useSharedValue(1)

  useEffect(() => {
    if (active) {
      scale.value = withSpring(1.18, TAB_SPRING)
    } else {
      scale.value = withSpring(1, TAB_SPRING)
    }
  }, [active, scale])

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6 }}
    >
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={24} color={active ? '#ff5da2' : '#9a8e96'} />
      </Animated.View>
      <Text
        style={{
          fontSize: 9,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: active ? colors.candyPink : colors.ink400,
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/* ------------------------------------------------------------------ */
/*  Animated FAB (press scale)                                          */
/* ------------------------------------------------------------------ */
const FAB_SPRING = { damping: 10, stiffness: 250 }

function AnimatedFab({ label }: { label: string }) {
  const scale = useSharedValue(1)
  const fabRef = useRef<Animated.View & RNView>(null)
  const inflight = useRef(false)
  const { fabLayout } = useAddTransition()

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const navigate = useCallback(() => {
    if (inflight.current) return
    inflight.current = true
    setTimeout(() => { inflight.current = false }, 600)
    router.push('/add')
  }, [])

  const handlePress = useCallback(() => {
    if (inflight.current) return
    if (!fabRef.current) {
      navigate()
      return
    }
    fabRef.current.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        fabLayout.value = { x, y, width, height }
      }
      navigate()
    })
  }, [fabLayout, navigate])

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        scale.value = withSpring(0.85, FAB_SPRING)
      }}
      onPressOut={() => {
        scale.value = withSpring(1, FAB_SPRING)
      }}
      onPress={handlePress}
    >
      <Animated.View
        ref={fabRef}
        style={[
          {
            width: 58,
            height: 58,
            marginTop: -34,
            borderRadius: 999,
            backgroundColor: '#ff2e88',
            borderWidth: 3,
            borderColor: '#191017',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#191017',
            shadowOffset: { width: 5, height: 5 },
            shadowOpacity: 1,
            shadowRadius: 0,
          },
          style,
        ]}
      >
        <Icon name="plus" size={28} color="#fff" />
      </Animated.View>
    </Pressable>
  )
}

/* ------------------------------------------------------------------ */
/*  TabBar (narrow / mobile)                                           */
/* ------------------------------------------------------------------ */
function TabBar({ props }: { props: TabBarProps }) {
  const { t } = useI18n()
  const { activeRoute, go } = useNav(props)
  const insets = useSafeAreaInsets()

  const tab = (n: NavMeta) => (
    <AnimatedTab
      key={n.route}
      active={activeRoute === n.route}
      icon={n.icon}
      label={t(n.labelKey)}
      onPress={() => go(n.route)}
    />
  )

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderTopWidth: 3,
        borderTopColor: colors.ink900,
        backgroundColor: colors.white,
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      {tab(NAV[0])}
      {tab(NAV[1])}

      {/* center FAB → add route */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <AnimatedFab label={t('log_taste')} />
      </View>

      {tab(NAV[2])}
      {tab(NAV[3])}
    </View>
  )
}

/* ------------------------------------------------------------------ */
/*  AppNav — responsive switch                                         */
/* ------------------------------------------------------------------ */
export function AppNav(props: TabBarProps) {
  const { width } = useWindowDimensions()
  // width ≥ 769px → desktop/tablet sidebar; narrower → bottom tab bar.
  // Replaces the old responsive media breakpoint (~769px).
  if (width >= 769) {
    return <Sidebar props={props} />
  }
  return <TabBar props={props} />
}

/** Sidebar width — screens add this as left padding on wide layouts. */
export { SIDEBAR_W }
