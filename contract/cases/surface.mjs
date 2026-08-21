// The shape of the controller itself.
//
// These run before anything is initialized on purpose: a platform that only
// assembles its surface after a successful init would leave every call site
// asking whether a method exists yet.
import assert from 'node:assert/strict';

import { PLATFORM_CONTRACT } from '../manifest.js';

export const cases = [
  {
    name: 'controller-exposes-exactly-the-manifest',
    environment: 'generic-web',
    run({ createController }) {
      const controller = createController();
      assert.deepEqual(
        Object.keys(controller).sort(),
        [...PLATFORM_CONTRACT],
        'the controller must expose the contract and nothing else'
      );
    },
  },
  {
    name: 'every-contract-method-is-callable',
    environment: 'generic-web',
    run({ createController }) {
      const controller = createController();
      for (const name of PLATFORM_CONTRACT) {
        assert.equal(
          typeof controller[name],
          'function',
          `${name} must be a function, got ${typeof controller[name]}`
        );
      }
    },
  },
];
