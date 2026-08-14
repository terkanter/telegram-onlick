import { getGatewayPermissions } from '../util/telegramGateway';
import useDerivedState from './useDerivedState';

// Role flags from the platform (see `telegram-fork-roles.md` §1). Fail-open: a missing block or
// field means the feature stays visible (the old platform and the pre-load moment behave this
// way, and critical actions are still rejected by the server). Live-updates as the signal changes.
export default function useGatewayPermissions() {
  const permissions = useDerivedState(getGatewayPermissions);

  return {
    canSearch: permissions?.search !== false,
    canViewUsernames: permissions?.viewUsernames !== false,
    canForwardMessages: permissions?.forwardMessages !== false,
  };
}
