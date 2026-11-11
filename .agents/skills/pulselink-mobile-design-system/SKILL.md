---
name: pulselink-mobile-design-system
description: Cross-platform PulseLink mobile UI/UX design and implementation guidance for React Native, using shared PulseLink foundations, Apple HIG, Material 3 and accessibility standards.
---

# PulseLink Mobile Design System

Use this skill for PulseLink mobile screen design, component work, navigation,
accessibility audits, visual consistency reviews and React Native refactoring.
Do not use it for backend-only or firmware-only work.

The canonical specification is in `docs/design-system/mobile/`. Read the
relevant documents before changing UI; do not create a second design system.

## Required workflow

1. Understand the user journey and screen purpose.
2. Inspect existing implementation, dependencies and canonical tokens.
3. Identify shared requirements, then iOS and Android requirements separately.
4. Design loading, empty, success, error, offline and permission states.
5. Check accessibility: labels, reading order, contrast, text scaling, targets,
   keyboard/switch access, screen readers and reduced motion.
6. Implement semantic reusable components and keep business authorization in
   domain/services, not visual components.
7. Use native platform behavior where it matters. Use React Native `Platform`
   or `.ios`/`.android` files for justified differences.
8. Verify API integration without changing business contracts or exposing
   credentials, FCM tokens, session secrets or invitation hashes.
9. Review hierarchy, interaction, content and platform conventions.
10. Run relevant tests and platform QA; report implemented, automated-tested,
    owner-reported and independently verified states separately.

## Non-negotiable PulseLink rules

- StoreMembership is the authorization source; never infer role from UI state.
- Device Online means backend-confirmed status, not local SoftAP success.
- Device identity is not a credential; never display operational credentials.
- Invitation default role is STAFF and recipient identity must be verified.
- Notifications remain Account → active membership → AppInstallation.
- Use semantic tokens and update the canonical docs for shared design changes.

Before a design review, use the source links in `references.md` and the
checklist in `design-review-checklist.md`. The upstream `apple-design-skill`
review method is a reference only; its files are not vendored here.
