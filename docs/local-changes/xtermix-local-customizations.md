# xtermix customizations

This repository snapshot contains application-level customizations for Termix.

## Main areas

- Host sharing compatibility for credential-based and legacy inline authentication flows.
- RBAC and permission handling improvements around host and credential access.
- Host manager UI updates for sharing and credential handling.
- SSH terminal and Guacamole route compatibility updates.
- Service worker and runtime configuration adjustments.
- Locale key updates for the related UI changes.

## Verification

- `npm run type-check` passes with `tsc --noEmit`.
