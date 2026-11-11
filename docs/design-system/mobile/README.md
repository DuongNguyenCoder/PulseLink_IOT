# PulseLink Mobile Design System

Canonical design specification for the future React Native Owner application.
This is a product design foundation, not a production screen implementation.

## Three levels

1. **Shared foundations** define PulseLink identity, semantic tokens,
   information hierarchy, accessibility, business states and UX behavior.
2. **Platform guidance** defines where iOS and Android should feel native,
   including navigation, system UI, sheets, permissions, typography and input.
3. **React Native guidance** defines how shared components, tokens and
   platform variants are implemented without leaking business rules into UI.

The Android diagnostic harness in `apps/android-fcm-test` is not the production
app. `apps/mobile` is reserved for WP7.

## Documents

- [Design philosophy](design-philosophy.md) and [principles](design-principles.md)
- [Tokens](design-tokens.md), [typography](typography.md), [color](color-system.md), and [layout](layout-and-spacing.md)
- [Components](component-system.md), [navigation](navigation-system.md), and [interaction](interaction-patterns.md)
- [Accessibility](accessibility-standard.md)
- [iOS](ios-guidelines.md), [Android](android-guidelines.md), and [React Native](react-native-guidelines.md)
- [PulseLink UX patterns](pulselink-ux-patterns.md)
- [Review checklist](design-review-checklist.md)
- [References](references.md)

## Change rule

Shared visual or behavioral decisions belong here first. A platform exception
must explain why the native convention improves usability or accessibility.
Do not add one-off colors, spacing, typography or interaction patterns in a
screen without updating this specification or recording the decision as open.
