import type { World } from '@iwsdk/core';

type NavigationHandler = () => void | Promise<void>;

let enterClubHandler: NavigationHandler | null = null;
let leaveClubHandler: NavigationHandler | null = null;

/**
 * Install the in-document arena <-> club transition handlers. The standalone
 * pub page never installs these, so it keeps the old page-navigation fallback.
 */
export function setClubNavigationHandlers(handlers: {
  enter: NavigationHandler;
  leave: NavigationHandler;
}): () => void {
  enterClubHandler = handlers.enter;
  leaveClubHandler = handlers.leave;
  return () => {
    if (enterClubHandler === handlers.enter) enterClubHandler = null;
    if (leaveClubHandler === handlers.leave) leaveClubHandler = null;
  };
}

function endSessionAndNavigate(world: World, url: string): void {
  const go = (): void => window.location.assign(url);
  const session = world.session as XRSession | undefined;
  if (session) void Promise.resolve(session.end()).then(go, go);
  else go();
}

export function requestClubEntry(world: World, fallbackUrl: string): void {
  if (enterClubHandler) {
    void enterClubHandler();
    return;
  }
  endSessionAndNavigate(world, fallbackUrl);
}

export function requestArenaReturn(world: World): void {
  if (leaveClubHandler) {
    void leaveClubHandler();
    return;
  }
  endSessionAndNavigate(world, 'index.html');
}
