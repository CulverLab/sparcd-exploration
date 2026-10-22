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

  // The newest sign-in or sign-out in any SPARC'd tab carries over to this one.
  // The session module drops older ones and answers other tabs itself, so the
  // getter it still takes is unused.
  useEffect(
    () =>
      subscribeSharedConnection(
        (cfg) => {
          if (!cfg) stopChecking();
          adoptSession(cfg);
        },
        () => null,
      ),
    [adoptSession],
  );

  if (!config) return <SignIn />;
  return screen === 'workspace' && hasModel ? <Workspace /> : <Chooser />;
}
