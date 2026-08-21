import * as bridge from './bridge.js';

export function createPlatformController() {
  return {
    bump: bridge.bump,
    count: bridge.count,
    flavourName: bridge.flavourName,
    globalProbe: bridge.globalProbe,
    userAgent: bridge.userAgent,
  };
}
