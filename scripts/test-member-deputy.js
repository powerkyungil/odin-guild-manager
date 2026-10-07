const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(root, 'deputy-ui.js'), 'utf8');
const supportSource = fs.readFileSync(path.join(root, 'support.html'), 'utf8');
const profileSource = fs.readFileSync(path.join(root, 'edit_profile.html'), 'utf8');
const voteSource = fs.readFileSync(path.join(root, 'boss_vote.js'), 'utf8');

class StorageMock {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const requestCalls = [];
let issueStatus = 200;
let issueCounter = 0;
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const targetData = [
  {
    ownerUserId: 11,
    ownerNickname: '맡긴회원',
    characters: [
      { characterKey: 'MAIN:11', characterType: 'MAIN', ownerUserId: 11, ownerNickname: '맡긴회원', characterName: '본캐', mainClass: '팔라딘', combatPower: 123456 },
      { characterKey: 'ALTERNATE:11:1', characterType: 'ALTERNATE', ownerUserId: 11, ownerNickname: '맡긴회원', characterName: '부캐', mainClass: '바드', combatPower: 654321 }
    ]
  },
  {
    ownerUserId: 22,
    ownerNickname: '두번째회원',
    characters: [
      { characterKey: 'MAIN:22', characterType: 'MAIN', ownerUserId: 22, ownerNickname: '두번째회원', characterName: '두번째 본캐', mainClass: '버서커', combatPower: 100000 }
    ]
  }
];

const localStorage = new StorageMock({
  token: 'member-token-original',
  role: 'MEMBER',
  principalType: 'USER',
  username: 'member-user',
  nickname: '기본 회원',
  userId: '9'
});
const sessionStorage = new StorageMock();
const window = {
  location: { pathname: '/support.html', href: '', replace() {}, reload() {} },
  addEventListener() {},
  dispatchEvent() {}
};
const document = { readyState: 'loading', addEventListener() {} };

const sandbox = {
  window,
  document,
  localStorage,
  sessionStorage,
  CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  fetch: async (url, options = {}) => {
    const call = { url: String(url), options, body: options.body ? JSON.parse(options.body) : null };
    requestCalls.push(call);
    if (call.url === '/api/v1/member-delegations') {
      if (options.method === 'POST') return response(201, { data: { id: 7 } });
      return response(200, { data: { owned: [], received: [{ id: 3, ownerUserId: 11, deputyUserId: 9, ownerNickname: '맡긴회원', isActive: true }] } });
    }
    if (call.url === '/api/v1/member-delegations/targets') return response(200, { data: targetData });
    if (call.url === '/api/v1/member-delegations/session') {
      if (issueStatus !== 200) return response(issueStatus, { error: issueStatus === 403 ? '부주 권한이 없습니다.' : '요청 실패' });
      issueCounter += 1;
      return response(200, { data: { token: `member-deputy-token-${issueCounter}` } });
    }
    if (call.url.startsWith('/api/v1/member-delegations/')) return response(204, {});
    if (call.url.startsWith('/api/v1/support-requests')) return response(200, { data: [] });
    throw new Error(`Unexpected API request: ${call.url}`);
  }
};

vm.runInNewContext(uiSource, sandbox, { filename: 'deputy-ui.js' });

(async () => {
  await window.odinDeputyReady;
  assert.equal(window.odinGetSession().isDeputy, false, 'regular MEMBER remains a regular account');
  assert.equal(window.odinIsMemberDeputyMode(), false, 'initial mode is the basic MEMBER mode');
  assert.equal(window.odinGetSupportToken(), 'member-token-original');

  const targetCalls = requestCalls.filter(call => call.url.endsWith('/targets'));
  assert.equal(targetCalls.length, 1, 'delegation targets load once at startup');
  assert.equal(targetCalls[0].options.headers.Authorization, 'Bearer member-token-original', 'targets use the base MEMBER token');

  await window.odinStartMemberDeputy(11, 'MAIN:11');
  assert.equal(window.odinIsMemberDeputyMode(), true, 'issuing a session switches to MEMBER_DEPUTY mode');
  assert.equal(window.odinGetSession().token, 'member-token-original', 'base MEMBER token stays unchanged');
  assert.equal(window.odinGetSupportToken(), 'member-deputy-token-1', 'support APIs select the MEMBER_DEPUTY token');
  assert.equal(localStorage.getItem('token'), 'member-token-original', 'persistent base token is not overwritten');
  assert.equal(localStorage.getItem('memberDeputyToken'), 'member-deputy-token-1', 'deputy token is stored separately');
  const firstIssue = requestCalls.find(call => call.url.endsWith('/session'));
  assert.equal(firstIssue.options.headers.Authorization, 'Bearer member-token-original', 'session issuance uses the base token');
  assert.deepEqual(firstIssue.body, { ownerUserId: 11, characterKey: 'MAIN:11' });

  await window.odinStartMemberDeputy(22, 'MAIN:22');
  assert.equal(window.odinGetSupportToken(), 'member-deputy-token-2', 'switching target issues a fresh deputy token');
  const issueCalls = requestCalls.filter(call => call.url.endsWith('/session'));
  assert.equal(issueCalls[1].options.headers.Authorization, 'Bearer member-token-original', 'target changes still use the base token');
  assert.deepEqual(issueCalls[1].body, { ownerUserId: 22, characterKey: 'MAIN:22' });

  await window.odinFetchSupportApi('/api/v1/support-requests');
  const deputySupportCall = requestCalls.find(call => call.url === '/api/v1/support-requests');
  assert.equal(deputySupportCall.options.headers.Authorization, 'Bearer member-deputy-token-2', 'hand-support request uses MEMBER_DEPUTY token');

  await window.odinRegisterMemberDeputy(44);
  const registration = requestCalls.find(call => call.options.method === 'POST' && call.url === '/api/v1/member-delegations');
  assert.equal(registration.options.headers.Authorization, 'Bearer member-token-original');
  assert.deepEqual(registration.body, { deputyUserId: 44 }, 'registration sends only the contracted deputyUserId');
  await window.odinRemoveMemberDeputy(44);
  const removal = requestCalls.find(call => call.options.method === 'DELETE');
  assert.equal(removal.url, '/api/v1/member-delegations/44');
  assert.equal(removal.options.headers.Authorization, 'Bearer member-token-original', 'relation removal uses the base token');

  issueStatus = 403;
  await assert.rejects(() => window.odinStartMemberDeputy(11, 'MAIN:11'), /부주 권한/);
  assert.equal(window.odinIsMemberDeputyMode(), true, '403 is a permission error and does not clear the deputy session');
  assert.equal(window.odinGetSupportToken(), 'member-deputy-token-2');
  issueStatus = 200;

  assert.equal(window.odinHandleMemberDeputyUnauthorized(), true, 'a deputy API 401 is handled as deputy-session expiry');
  assert.equal(window.odinIsMemberDeputyMode(), false, '401 returns to the basic MEMBER mode');
  assert.equal(window.odinGetSupportToken(), 'member-token-original');
  assert.equal(localStorage.getItem('token'), 'member-token-original', '401 recovery preserves the base token');
  assert.equal(localStorage.getItem('memberDeputyToken'), null, '401 recovery removes the expired deputy token');
  await window.odinFetchSupportApi('/api/v1/support-requests');
  const basicSupportCall = requestCalls.filter(call => call.url === '/api/v1/support-requests').at(-1);
  assert.equal(basicSupportCall.options.headers.Authorization, 'Bearer member-token-original', 'hand-support returns to base token after deputy 401');

  assert.match(supportSource, /window\.odinFetchSupportApi\(url, options\)/, 'hand-support API requests use the active support token');
  assert.match(supportSource, /window\.odinHandleMemberDeputyUnauthorized\?\.\(\)/, 'hand-support 401 handling returns from deputy mode');
  assert.match(supportSource, /window\.odinGetMemberDeputyTarget\?\.\(\)/, 'only hand-support uses the selected MEMBER_DEPUTY character');
  assert.match(supportSource, /memberDeputySupportContext/, 'hand-support page shows the delegated character context');
  assert.match(profileSource, /window\.odinRegisterMemberDeputy\(deputyUserId\)/);
  assert.match(profileSource, /window\.odinRemoveMemberDeputy\(delegation\.deputyUserId\)/);
  assert.match(uiSource, /current && selectedOwner && current\.ownerUserId === selectedOwner\.ownerUserId/,
    'empty deputy target lists do not dereference a missing current character');
  assert.match(uiSource, /position: fixed;/, 'session banner remains a top-level floating control');
  assert.match(uiSource, /document\.body\.appendChild\(banner\)/,
    'session banner is mounted at the page root');
  assert.match(uiSource, /data-collapsed="true"/,
    'session banner starts in its compact state');
  assert.match(uiSource, /\.odin-context-save-member,\s*\.odin-context-exit/,
    'member deputy controls receive the shared button styling');
  assert.match(uiSource, /document\.addEventListener\('pointerdown'/,
    'open session controls close when focus moves outside');
  assert.match(voteSource, /window\.addEventListener\('odin-session-context-changed'/,
    'vote target follows deputy mode transitions');
  assert.match(voteSource, /window\.odinGetSupportToken\?\./,
    'vote API calls use the active session token');
  assert.match(voteSource, /window\.odinGetMemberDeputyTarget\?\.\(\)/,
    'member deputy votes use the selected delegated character');
  assert.match(voteSource, /setVoteTargetPanelVisible\(false\)/,
    'vote target picker is hidden when the top-level context control can select the activity target');
  assert.match(voteSource, /setVoteTargetPanelVisible\(true\)/,
    'vote target picker remains available for accounts without a top-level activity target');
  assert.doesNotMatch(supportSource, /JSON\.stringify\(\{[^}]*ownerUserId/);

  console.log('Member deputy session tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
