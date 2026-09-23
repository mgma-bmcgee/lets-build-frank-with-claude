import { describe, expect, it } from 'vitest';
import { ConfigError, LOOPBACK_HOSTS, loadConfig } from '../src/config.js';

const AZURE = {
  AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000001',
  AZURE_RESOURCE_GROUP: 'rg-frank-class',
  AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
  AZURE_TENANT_ID: '00000000-0000-0000-0000-000000000003',
  AZURE_CLIENT_SECRET: 'placeholder-not-a-real-secret',
};

describe('loadConfig', () => {
  it('defaults PORT to 3000 and needs nothing else to boot', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('treats an empty PORT as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  it('reads PORT', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it.each(['abc', '0', '70000', '30.5'])('rejects PORT=%s with a plain message', (port) => {
    let error: unknown;
    try {
      loadConfig({ PORT: port });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('PORT');
    expect(message).toContain(`'${port}'`);
    expect(message).not.toMatch(/Too (small|big)|expected/);
    expect(message).not.toMatch(/\n\s+at /);
  });

  it('leaves Azure unconfigured (fail closed) when any Azure variable is missing', () => {
    const config = loadConfig({ ...AZURE, AZURE_CLIENT_SECRET: '' });
    expect(config.azure).toBeNull();
    expect(config.missingAzureVars).toEqual(['AZURE_CLIENT_SECRET']);
  });

  it('reports every missing Azure variable', () => {
    expect(loadConfig({}).missingAzureVars).toEqual(Object.keys(AZURE));
  });

  it('exposes the Azure scope when all variables are set, but never the secret', () => {
    const config = loadConfig(AZURE);
    expect(config.azure).toEqual({ subscriptionId: AZURE.AZURE_SUBSCRIPTION_ID, resourceGroup: 'rg-frank-class' });
    expect(JSON.stringify(config)).not.toContain(AZURE.AZURE_CLIENT_SECRET);
  });

  it('allows only loopback hosts outside Container Apps', () => {
    expect(loadConfig({}).allowedHosts).toEqual(LOOPBACK_HOSTS);
  });

  it('adds the Container Apps FQDN when both platform variables are present', () => {
    const config = loadConfig({
      CONTAINER_APP_NAME: 'frank-octocat',
      CONTAINER_APP_ENV_DNS_SUFFIX: 'Happy-Hill-123.eastus.azurecontainerapps.io',
    });
    expect(config.allowedHosts).toEqual([...LOOPBACK_HOSTS, 'frank-octocat.happy-hill-123.eastus.azurecontainerapps.io']);
  });

  it('does not guess an FQDN from half the platform variables', () => {
    expect(loadConfig({ CONTAINER_APP_NAME: 'frank-octocat' }).allowedHosts).toEqual(LOOPBACK_HOSTS);
  });
});
