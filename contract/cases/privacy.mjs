import assert from 'node:assert/strict';

export const cases = [{
  name: 'generic-web-privacy-options-are-unavailable',
  environment: 'generic-web',
  async run({ createController }) {
    const controller = createController();
    assert.deepEqual(controller.getPrivacyOptionsState(), { available: false, busy: false });
    assert.equal(await controller.showPrivacyOptions(), false);
  },
}];
