const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api-config.js'), 'utf8');

const loadConfig = (hostname, configuredOrigin) => {
  const calls = [];
  const window = {
    location: { hostname },
    fetch: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        async json() { return { data: { value: 1 } }; }
      };
    }
  };
  if (configuredOrigin !== undefined) window.ODIN_API_ORIGIN = configuredOrigin;
  vm.runInNewContext(source, { window, Set, Object, String });
  return { window, calls };
};

(async () => {
  const local = loadConfig('localhost');
  await local.window.fetch('/api/v1/auth/login', { method: 'POST' });
  await local.window.fetch('/maintenance/status');
  assert.equal(local.window.odinApiConfig.origin, 'http://localhost:3001');
  assert.equal(local.calls[0][0], 'http://localhost:3001/api/v1/auth/login');
  assert.equal(local.calls[1][0], '/maintenance/status');
  assert.deepEqual(await (await local.window.fetch('/api/v1/time')).json(), { value: 1 });

  const loopback = loadConfig('127.0.0.1');
  await loopback.window.fetch('/api/v1/auth/me');
  assert.equal(loopback.calls[0][0], 'http://localhost:3001/api/v1/auth/me');

  const production = loadConfig('guild.example.com');
  await production.window.fetch('/api/v1/guild/settings');
  assert.equal(production.window.odinApiConfig.origin, 'https://api.hanul-on.cloud');
  assert.equal(production.calls[0][0], 'https://api.hanul-on.cloud/api/v1/guild/settings');

  const separateProductionApi = loadConfig('guild.example.com', 'https://api.guild.example.com/');
  await separateProductionApi.window.fetch('/api/v1/distributions');
  assert.equal(separateProductionApi.window.odinApiConfig.origin, 'https://api.guild.example.com');
  assert.equal(separateProductionApi.calls[0][0], 'https://api.guild.example.com/api/v1/distributions');

  const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith('.html'));
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /<script src="api-config\.js"><\/script>/, `${file} must load api-config.js`);
  }

  console.log('API environment configuration tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
