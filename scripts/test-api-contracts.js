const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const browserFiles = fs.readdirSync(root)
  .filter(file => file.endsWith('.html') || file.endsWith('.js'))
  .filter(file => file !== 'server.js');

const legacyCalls = [];
for (const file of browserFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    const matches = line.matchAll(/\/api\/(?!v1(?:\/|\?|$))[^'"`\s<)]*/g);
    for (const match of matches) legacyCalls.push(`${file}:${index + 1} ${match[0]}`);
  });
}

assert.deepEqual(legacyCalls, [], `legacy API calls remain:\n${legacyCalls.join('\n')}`);

const config = fs.readFileSync(path.join(root, 'api-config.js'), 'utf8');
assert.match(config, /LOCAL_API_ORIGIN = 'http:\/\/localhost:3001'/);
assert.match(config, /PRODUCTION_API_ORIGIN = 'https:\/\/api\.hanul-on\.cloud'/);

const voteSource = fs.readFileSync(path.join(root, 'boss_vote.js'), 'utf8');
assert.doesNotMatch(voteSource, /data-action="(?:close|delete|remove-participant)"/);

const legacyCollections = fs.readFileSync(path.join(root, 'collections.html'), 'utf8');
assert.match(legacyCollections, /location\.replace\('collections_v2\.html'\)/);

console.log('V1 API contract scan passed.');
