import crypto from 'node:crypto';

if (typeof crypto.getRandomValues !== 'function' && typeof crypto.webcrypto?.getRandomValues === 'function') {
  crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
}

const { build, createServer, loadEnv, preview } = await import('vite');

function parseArgs(argv) {
  const parsed = {
    mode: undefined,
    host: undefined,
    port: undefined,
    strictPort: undefined,
    open: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') parsed.mode = argv[++i];
    else if (arg === '--host') parsed.host = argv[++i] ?? true;
    else if (arg === '--port') parsed.port = Number(argv[++i]);
    else if (arg === '--strictPort') parsed.strictPort = true;
    else if (arg === '--open') parsed.open = true;
  }

  return parsed;
}

async function waitForever(close) {
  const shutdown = async () => {
    await close?.();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
}

const [, , command = 'build', ...rest] = process.argv;
const parsed = parseArgs(rest);
const defaultMode = command === 'build' ? 'production' : 'development';
const viteEnv = {
  ...loadEnv(parsed.mode || defaultMode, process.cwd(), 'VITE_'),
  ...process.env,
};

if (viteEnv.VITE_ADMOB_MEDIATION_QA === 'true') {
  const testDeviceIds = String(viteEnv.VITE_ADMOB_TEST_DEVICE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (viteEnv.VITE_NATIVE_ADS_TEST_MODE === 'false' || !testDeviceIds.length) {
    throw new Error(
      'AdMob mediation QA requires native test mode and VITE_ADMOB_TEST_DEVICE_IDS.',
    );
  }
}

if (command === 'build') {
  await build({
    mode: parsed.mode,
  });
} else if (command === 'dev' || command === 'start') {
  const server = await createServer({
    mode: parsed.mode,
    server: {
      host: parsed.host,
      port: parsed.port,
      strictPort: parsed.strictPort,
      open: parsed.open,
    },
  });
  await server.listen();
  server.printUrls();
  await waitForever(() => server.close());
} else if (command === 'preview') {
  const previewServer = await preview({
    mode: parsed.mode,
    preview: {
      host: parsed.host,
      port: parsed.port,
      strictPort: parsed.strictPort,
      open: parsed.open,
    },
  });
  previewServer.printUrls();
  await waitForever(() => previewServer.httpServer?.close());
} else {
  console.error(`Unknown Vite command: ${command}`);
  process.exit(1);
}
