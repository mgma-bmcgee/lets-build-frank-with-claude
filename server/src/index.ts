import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  // A bad setting is an operator mistake, not a crash: say what to fix.
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const server = createApp(config).listen(config.port, () => {
  const azure = config.azure
    ? `Azure scope ${config.azure.resourceGroup}`
    : `Azure not configured (missing ${config.missingAzureVars.join(', ')}); Azure tools will fail closed`;
  console.log(`[frank] ${config.version} listening on :${config.port} - ${azure}`);
});

function shutdown(signal: string): void {
  console.log(`[frank] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  // Don't hang on keep-alive connections past the platform's grace period.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
