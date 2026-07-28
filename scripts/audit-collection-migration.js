const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});
const close = () => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()));

async function main() {
    const legacy = await get("SELECT COUNT(*) AS count FROM user_collections");
    const v2 = await get("SELECT COUNT(*) AS count FROM user_collection_items");
    const activeItems = await get("SELECT COUNT(*) AS count FROM collection_items WHERE is_active = 1");
    const unmatched = await get(`
        SELECT COUNT(*) AS count
        FROM user_collections uc
        WHERE NOT EXISTS (
            SELECT 1 FROM collection_items ci WHERE ci.legacy_key = uc.collection_name
        )
    `);
    const orphanV2 = await get(`
        SELECT COUNT(*) AS count
        FROM user_collection_items uci
        WHERE NOT EXISTS (
            SELECT 1 FROM collection_items ci WHERE ci.id = uci.collection_item_id
        )
    `);
    const migration = await get(
        "SELECT applied_at, details FROM app_migrations WHERE name = ?",
        ['2026-collection-item-ids-v1']
    );

    console.table({
        legacyChecks: legacy.count,
        v2Checks: v2.count,
        activeItems: activeItems.count,
        unmatchedLegacyChecks: unmatched.count,
        orphanV2Checks: orphanV2.count
    });
    console.log('Migration:', migration || 'not applied');

    if (!migration || unmatched.count > 0 || orphanV2.count > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
}).finally(close);
