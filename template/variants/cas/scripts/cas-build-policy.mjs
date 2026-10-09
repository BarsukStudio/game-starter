// Live ads require an explicit QA opt-in or the native release wrapper.
export function assertCasBuildPolicy(env, { release = false } = {}) {
  if (release) return;
  if (env.VITE_NATIVE_ADS_TEST_MODE === 'false' && env.CAS_REAL_NETWORK_QA !== '1' && env.CAS_RELEASE_BUILD !== '1') {
    throw new Error('Real CAS ads require CAS_REAL_NETWORK_QA=1 for local QA or the native release wrapper.');
  }
}
