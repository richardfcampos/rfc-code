import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_RFC_URL, defaultConfigPath, resolveRfcConfig, RfcConfigError } from '../rfc-cli-config.js';

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rfc-cli-config-'));
}

test('environment variables win and the url loses its trailing slash', () => {
  const config = resolveRfcConfig({ RFC_URL: 'http://vps:7799/', RFC_API_KEY: 'ck_env', HOME: tempHome() });
  assert.deepEqual(config, { url: 'http://vps:7799', apiKey: 'ck_env' });
});

test('falls back to ~/.rfc-code/rfc-cli.json and the default url', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.rfc-code'));
  fs.writeFileSync(path.join(home, '.rfc-code', 'rfc-cli.json'), JSON.stringify({ apiKey: 'ck_file' }));
  const config = resolveRfcConfig({ HOME: home });
  assert.deepEqual(config, { url: DEFAULT_RFC_URL, apiKey: 'ck_file' });
});

test('RFC_CLI_CONFIG overrides the file location', () => {
  const home = tempHome();
  const custom = path.join(home, 'custom.json');
  fs.writeFileSync(custom, JSON.stringify({ url: 'https://code.example', apiKey: 'ck_custom' }));
  assert.equal(defaultConfigPath({ RFC_CLI_CONFIG: custom }), custom);
  assert.deepEqual(resolveRfcConfig({ HOME: home, RFC_CLI_CONFIG: custom }), { url: 'https://code.example', apiKey: 'ck_custom' });
});

test('a missing key is a config error that explains where to put one, without leaking anything', () => {
  const home = tempHome();
  assert.throws(() => resolveRfcConfig({ HOME: home }), (error: unknown) => {
    assert.ok(error instanceof RfcConfigError);
    assert.match(error.message, /Settings > API Tokens/);
    assert.match(error.message, /rfc-cli\.json/);
    return true;
  });
});

test('a malformed config file and a non-http url are rejected', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.rfc-code'));
  fs.writeFileSync(path.join(home, '.rfc-code', 'rfc-cli.json'), '{not json');
  assert.throws(() => resolveRfcConfig({ HOME: home }), /not valid JSON/);
  assert.throws(() => resolveRfcConfig({ HOME: tempHome(), RFC_API_KEY: 'k', RFC_URL: 'vps:7799' }), /http:\/\//);
});
