// How the two native banner removals behave in the case under test, and what
// they were actually asked to do.
//
// A module rather than a global: the SDK stand-ins are re-imported per case to
// defeat the ESM cache, and a handle held here survives that, so a case can
// still see what the copy it just loaded was called with.
export const HANGS = 'hangs';
export const REJECTS = 'rejects';
export const SETTLES = 'settles';

let current = null;

export function beginCase(behaviour) {
  current = {
    behaviour: { admob: SETTLES, yandex: SETTLES, ...behaviour },
    removed: [],
  };
  return current;
}

// Never resolves, never rejects — the shape of a native call whose plugin
// answers neither way, which is the failure this suite exists for.
const pending = () => new Promise(() => {});

export function removeBanner(provider) {
  current.removed.push(provider);
  const behaviour = current.behaviour[provider];
  if (behaviour === HANGS) return pending();
  if (behaviour === REJECTS) return Promise.reject(new Error(`${provider} removeBanner failed`));
  return Promise.resolve();
}
