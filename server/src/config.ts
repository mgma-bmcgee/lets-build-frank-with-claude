// All of Frank's settings come from environment variables (ADR-001), validated
// once at boot. Nothing here may hold a credential value: DefaultAzureCredential
// reads AZURE_CLIENT_SECRET from the environment itself (ADR-010), so config
// only records whether the Azure variables are present.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// src/config.ts and dist/config.js both sit one level below the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// An empty variable means "not set" — the pipeline and shells both produce them.
const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const envSchema = z.object({
  PORT: z.preprocess(
    (v) => (v === '' || v === undefined ? 3000 : Number(v)),
    z
      .number({ error: 'PORT must be a number' })
      .int('PORT must be a whole number')
      .min(1, 'PORT must be between 1 and 65535')
      .max(65535, 'PORT must be between 1 and 65535'),
  ),
  AZURE_SUBSCRIPTION_ID: optional,
  AZURE_RESOURCE_GROUP: optional,
  AZURE_CLIENT_ID: optional,
  AZURE_TENANT_ID: optional,
  AZURE_CLIENT_SECRET: optional,
  // Injected by Azure Container Apps: the first two form the app's FQDN; the
  // third is this revision's own hostname (<app>--<revision>.<suffix>).
  CONTAINER_APP_NAME: optional,
  CONTAINER_APP_ENV_DNS_SUFFIX: optional,
  CONTAINER_APP_HOSTNAME: optional,
});

const AZURE_VARS = [
  'AZURE_SUBSCRIPTION_ID',
  'AZURE_RESOURCE_GROUP',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
] as const;

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export interface AzureScope {
  subscriptionId: string;
  resourceGroup: string;
}

export interface Config {
  port: number;
  version: string;
  publicDir: string;
  /** Frank's Azure scope, or null when any Azure variable is missing (tools must fail closed). */
  azure: AzureScope | null;
  /** Names of the Azure variables that are not set, for plain-language errors. */
  missingAzureVars: string[];
  /** Hostnames allowed to reach /mcp (DNS-rebinding protection, plan step 6). */
  allowedHosts: string[];
  /** This app's own name (CONTAINER_APP_NAME), so tools can mark it `isSelf`. Null outside Container Apps. */
  selfAppName: string | null;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = issue.path.join('.');
      const got = env[name];
      return got === undefined ? issue.message : `${issue.message} (got '${got}')`;
    });
    throw new ConfigError(`Frank cannot start: ${problems.join('; ')}.`);
  }
  const e = parsed.data;

  const missingAzureVars = AZURE_VARS.filter((name) => e[name] === undefined);
  const azure =
    missingAzureVars.length === 0
      ? { subscriptionId: e.AZURE_SUBSCRIPTION_ID!, resourceGroup: e.AZURE_RESOURCE_GROUP! }
      : null;

  const allowedHosts = [...LOOPBACK_HOSTS];
  if (e.CONTAINER_APP_NAME && e.CONTAINER_APP_ENV_DNS_SUFFIX) {
    allowedHosts.push(`${e.CONTAINER_APP_NAME}.${e.CONTAINER_APP_ENV_DNS_SUFFIX}`.toLowerCase());
  }
  if (e.CONTAINER_APP_HOSTNAME) allowedHosts.push(e.CONTAINER_APP_HOSTNAME.toLowerCase());

  return {
    port: e.PORT,
    version: readVersion(),
    publicDir: resolve(packageRoot, 'public'),
    azure,
    missingAzureVars,
    allowedHosts,
    selfAppName: e.CONTAINER_APP_NAME?.toLowerCase() ?? null,
  };
}
