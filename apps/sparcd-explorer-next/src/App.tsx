import { useEffect } from 'react';
import { subscribeSharedConnection } from '@sparcd/auth-ui';
import { useStore } from './store';
import { SignIn } from './components/SignIn';
import { Chooser } from './components/Chooser';
import { Workspace } from './components/Workspace';
import { stopChecking } from './lib/opening';

export function App() {
  const config = useStore((s) => s.config);
  const screen = useStore((s) => s.screen);
  const adoptSession = useStore((s) => s.adoptSession);
  const hasModel = useStore((s) => s.model !== null);

  // Signing in or out in any SPARC'd tab carries over to this one.
  useEffect(
    () =>
      subscribeSharedConnection(
        (cfg) => {
          if (!cfg) stopChecking();
          adoptSession(cfg);
        },
        () => useStore.getState().config,
      ),
    [adoptSession],
  );

  if (!config) return <SignIn />;
  return screen === 'workspace' && hasModel ? <Workspace /> : <Chooser />;
}
