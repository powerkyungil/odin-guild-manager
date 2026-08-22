const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hanulon-privacy-'));
const databasePath = path.join(temporaryDirectory, 'privacy-test.sqlite');
const port = 32000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const testPassword = 'member-password-123';

const server = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: databasePath,
        JWT_SECRET: 'privacy-test-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });

const requestJson = async (pathname, options = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    const body = await response.json();
    return { response, body };
};

const waitForServer = async () => {
    // A fresh database seeds the full boss/collection catalog before Express
    // begins accepting requests, which can take longer on CI machines.
    for (let attempt = 0; attempt < 400; attempt += 1) {
        if (server.exitCode !== null) throw new Error(`Server exited early:\n${serverOutput}`);
        try {
            const response = await fetch(`${baseUrl}/api/time`);
            if (response.ok) return;
        } catch (_) { }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start:\n${serverOutput}`);
};

(async () => {
    try {
        await waitForServer();

        const privacyResponse = await fetch(`${baseUrl}/privacy`);
        const privacyHtml = await privacyResponse.text();
        assert.equal(privacyResponse.status, 200);
        assert.match(privacyHtml, /한울ON 개인정보처리방침/);
        assert.match(privacyHtml, /NAVER Cloud Platform[\s\S]*CLOVA Template OCR/);
        assert.match(privacyHtml, /계정 하드 삭제/);

        const deletePageResponse = await fetch(`${baseUrl}/delete-account`);
        const deletePageHtml = await deletePageResponse.text();
        assert.equal(deletePageResponse.status, 200);
        assert.match(deletePageHtml, /계정 영구 삭제/);

        const masterLogin = await requestJson('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'master', password: 'password123' })
        });
        assert.equal(masterLogin.response.status, 200);

        const invite = await requestJson('/api/invites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterLogin.body.token}`
            },
            body: JSON.stringify({ targetRole: 'MEMBER' })
        });
        assert.equal(invite.response.status, 200);

        const registration = await requestJson('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: invite.body.inviteToken,
                username: 'privacy-delete-member',
                password: testPassword,
                nickname: '삭제테스트',
                occupation: '워리어',
                main_class: '디펜더',
                combat_power: 100,
                equipment: {},
                skills: {}
            })
        });
        assert.equal(registration.response.status, 200);

        const memberLogin = await requestJson('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'privacy-delete-member', password: testPassword })
        });
        assert.equal(memberLogin.response.status, 200);

        const wrongPasswordDelete = await requestJson('/api/users/me', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${memberLogin.body.token}`
            },
            body: JSON.stringify({ password: 'wrong-password' })
        });
        assert.equal(wrongPasswordDelete.response.status, 401);

        const deletion = await requestJson('/api/users/me', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${memberLogin.body.token}`
            },
            body: JSON.stringify({ password: testPassword })
        });
        assert.equal(deletion.response.status, 200);
        assert.equal(deletion.body.success, true);

        const staleToken = await requestJson('/api/users/me', {
            headers: { Authorization: `Bearer ${memberLogin.body.token}` }
        });
        assert.equal(staleToken.response.status, 401);

        const deletedLogin = await requestJson('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'privacy-delete-member', password: testPassword })
        });
        assert.equal(deletedLogin.response.status, 401);

        const protectedMasterDelete = await requestJson('/api/users/me', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${masterLogin.body.token}`
            },
            body: JSON.stringify({ password: 'password123' })
        });
        assert.equal(protectedMasterDelete.response.status, 403);

        console.log('Privacy page and hard-delete tests passed.');
    } finally {
        server.kill('SIGTERM');
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
