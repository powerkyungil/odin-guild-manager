const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const testDbPath = path.join(os.tmpdir(), `odin-collection-migration-${process.pid}.sqlite`);
const testPort = 32000 + (process.pid % 1000);
const jwtSecret = 'collection-migration-test-secret';
let serverProcess;
const serverOutput = [];

const openDb = (filename) => new sqlite3.Database(filename);
const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});
const close = db => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function seedLegacyDatabase() {
    const db = openDb(testDbPath);
    await run(db, `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        role TEXT,
        nickname TEXT,
        occupation TEXT,
        main_class TEXT,
        combat_power INTEGER,
        equipment TEXT,
        skills TEXT,
        max_crit_rate INTEGER DEFAULT 0,
        max_crit_resist INTEGER DEFAULT 0,
        status_effect_acc INTEGER DEFAULT 0
    )`);
    await run(db, `CREATE TABLE collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        items TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(db, `CREATE TABLE user_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        collection_name TEXT,
        UNIQUE(user_id, collection_name)
    )`);
    await run(
        db,
        `INSERT INTO users
            (id, username, password_hash, role, nickname, combat_power)
         VALUES (1, 'migration-master', 'unused', 'MASTER', '테스트길드장', 1000)`
    );
    await run(
        db,
        `INSERT INTO users
            (id, username, password_hash, role, nickname, combat_power)
         VALUES
            (2, 'migration-admin', 'unused', 'ADMIN', 'Migration Admin', 900),
            (3, 'migration-member', 'unused', 'MEMBER', 'Migration Member', 800)`
    );
    await run(
        db,
        "INSERT INTO collections (id, name, items) VALUES (1, ?, ?)",
        ['기존 컬렉션', JSON.stringify(['무기 | 강화 7'])]
    );
    await run(
        db,
        "INSERT INTO user_collections (user_id, collection_name) VALUES (1, ?)",
        ['기존 컬렉션||무기||강화 7']
    );
    await close(db);
}

async function request(pathname, token, options = {}) {
    const response = await fetch(`http://127.0.0.1:${testPort}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
    return body;
}

async function requestStatus(pathname, token, options = {}) {
    const response = await fetch(`http://127.0.0.1:${testPort}${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    return response.status;
}

async function waitForMigration(token) {
    let lastError;
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const collections = await request('/api/v2/collections', token);
            if (collections[0] && collections[0].items.length === 1) return collections;
        } catch (err) {
            lastError = err;
        }
        await delay(100);
    }
    throw lastError || new Error('Timed out waiting for collection migration.');
}

async function main() {
    await seedLegacyDatabase();

    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            DB_PATH: testDbPath,
            PORT: String(testPort),
            JWT_SECRET: jwtSecret
        },
        windowsHide: true
    });
    serverProcess.stdout.on('data', chunk => serverOutput.push(chunk.toString()));
    serverProcess.stderr.on('data', chunk => serverOutput.push(chunk.toString()));

    const token = jwt.sign(
        { id: 1, role: 'MASTER', username: 'migration-master', nickname: '테스트길드장' },
        jwtSecret,
        { expiresIn: '5m' }
    );

    const adminToken = jwt.sign(
        { id: 2, role: 'ADMIN', username: 'migration-admin', nickname: 'Migration Admin' },
        jwtSecret,
        { expiresIn: '5m' }
    );
    const memberToken = jwt.sign(
        { id: 3, role: 'MEMBER', username: 'migration-member', nickname: 'Migration Member' },
        jwtSecret,
        { expiresIn: '5m' }
    );

    const collections = await waitForMigration(token);
    const originalItemId = collections[0].items[0].id;

    if (await requestStatus('/api/collections', adminToken) !== 403) {
        throw new Error('V1 collections API must be master-only.');
    }
    if (await requestStatus('/api/user-collections', memberToken) !== 403) {
        throw new Error('V1 completion API must be master-only.');
    }

    const crossEditBody = JSON.stringify({
        userId: 1,
        collectionItemId: originalItemId,
        completed: true
    });
    if (await requestStatus('/api/v2/user-collections/toggle', adminToken, {
        method: 'POST',
        body: crossEditBody
    }) !== 403) {
        throw new Error('Admin must not edit another member completion.');
    }
    if (await requestStatus('/api/v2/user-collections/toggle', memberToken, {
        method: 'POST',
        body: crossEditBody
    }) !== 403) {
        throw new Error('Member must not edit another member completion.');
    }
    if (await requestStatus('/api/v2/user-collections/toggle', adminToken, {
        method: 'POST',
        body: JSON.stringify({
            userId: 2,
            collectionItemId: originalItemId,
            completed: true
        })
    }) !== 200) {
        throw new Error('Admin must retain permission to edit their own completion.');
    }
    const migratedStatuses = await request('/api/v2/user-collections', token);
    if (!migratedStatuses.some(row =>
        row.user_id === 1 && row.collection_item_id === originalItemId
    )) {
        throw new Error('Legacy check was not migrated to collection_item_id.');
    }

    await request('/api/v2/collections/1', token, {
        method: 'PUT',
        body: JSON.stringify({
            name: '이름이 바뀐 컬렉션',
            items: [{ id: originalItemId, part: '변경된 무기', enchantment: '강화 9' }]
        })
    });

    const editedCollections = await request('/api/v2/collections', token);
    if (editedCollections[0].items[0].id !== originalItemId) {
        throw new Error('Collection item ID changed after editing.');
    }
    const statusesAfterEdit = await request('/api/v2/user-collections', token);
    if (!statusesAfterEdit.some(row =>
        row.user_id === 1 && row.collection_item_id === originalItemId
    )) {
        throw new Error('Completion status was lost after editing.');
    }

    const renamedLegacyKey = '이름이 바뀐 컬렉션||변경된 무기||강화 9';
    const legacyStatusesAfterEdit = await request('/api/user-collections', token);
    if (!legacyStatusesAfterEdit.some(row =>
        row.user_id === 1 && row.collection_name === renamedLegacyKey
    )) {
        throw new Error('V1 legacy status key was not updated after a V2 edit.');
    }

    await request('/api/user-collections/toggle', token, {
        method: 'POST',
        body: JSON.stringify({
            userId: 1,
            collectionName: renamedLegacyKey,
            completed: false
        })
    });
    const v2StatusesAfterV1Removal = await request('/api/v2/user-collections', token);
    if (v2StatusesAfterV1Removal.some(row =>
        row.user_id === 1 && row.collection_item_id === originalItemId
    )) {
        throw new Error('V1 removal was not synchronized to V2.');
    }

    await request('/api/user-collections/toggle', token, {
        method: 'POST',
        body: JSON.stringify({
            userId: 1,
            collectionName: renamedLegacyKey,
            completed: true
        })
    });
    await request('/api/collections/1', token, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'V1에서 수정한 컬렉션',
            items: ['V1 수정 무기 | 강화 10']
        })
    });
    const collectionsAfterV1Edit = await request('/api/v2/collections', token);
    if (collectionsAfterV1Edit[0].items[0].id !== originalItemId) {
        throw new Error('V1 edit did not preserve the stable collection item ID.');
    }
    const statusesAfterV1Edit = await request('/api/v2/user-collections', token);
    if (!statusesAfterV1Edit.some(row =>
        row.user_id === 1 && row.collection_item_id === originalItemId
    )) {
        throw new Error('V2 completion status was lost after a V1 edit.');
    }

    await request('/api/v2/collections/1', token, {
        method: 'DELETE'
    });
    const legacyAfterDelete = await request('/api/user-collections', token);
    const v2AfterDelete = await request('/api/v2/user-collections', token);
    if (legacyAfterDelete.length !== 0 || v2AfterDelete.length !== 0) {
        throw new Error('Collection deletion left completion records behind.');
    }

    serverProcess.kill();
    await new Promise(resolve => serverProcess.once('exit', resolve));
    serverProcess = null;

    const db = openDb(testDbPath);
    const migration = await get(
        db,
        "SELECT details FROM app_migrations WHERE name = '2026-collection-item-ids-v1'"
    );
    await close(db);
    const details = JSON.parse(migration.details);
    if (details.legacyChecks !== 1 || details.matchedLegacyChecks !== 1) {
        throw new Error(`Unexpected migration audit: ${migration.details}`);
    }

    console.log('Collection item migration test passed.');
}

main().catch((err) => {
    console.error(err);
    if (serverOutput.length > 0) console.error(serverOutput.join(''));
    process.exitCode = 1;
}).finally(async () => {
    if (serverProcess) {
        serverProcess.kill();
        await Promise.race([
            new Promise(resolve => serverProcess.once('exit', resolve)),
            delay(2000)
        ]);
    }
    for (const suffix of ['', '-journal', '-shm', '-wal']) {
        const filename = `${testDbPath}${suffix}`;
        if (fs.existsSync(filename)) fs.rmSync(filename);
    }
});
