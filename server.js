const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Client, GatewayIntentBits } = require('discord.js');

// Load local-only settings without overriding values supplied by the host.
// .env is ignored by Git and is intended for development credentials.
const envFilePath = path.join(__dirname, '.env');
try {
    const envLines = fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/);
    envLines.forEach((line) => {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || match[1] in process.env) return;
        const [, key, rawValue] = match;
        const isQuoted = (rawValue.startsWith('"') && rawValue.endsWith('"'))
            || (rawValue.startsWith("'") && rawValue.endsWith("'"));
        process.env[key] = isQuoted ? rawValue.slice(1, -1) : rawValue;
    });
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}

const app = express();
const PORT = process.env.PORT || 3000;
let httpServerStarted = false;
const startHttpServer = () => {
    if (httpServerStarted) return;
    httpServerStarted = true;
    app.listen(PORT, () => {
        // Server running after database initialization and migrations complete.
    });
};
const JWT_SECRET = process.env.JWT_SECRET || 'odin-guild-secret-kyeongil';
const CLOVA_OCR_INVOKE_URL = process.env.CLOVA_OCR_INVOKE_URL;
const CLOVA_OCR_SECRET = process.env.CLOVA_OCR_SECRET;
const CLOVA_OCR_TEMPLATE_ID = process.env.CLOVA_OCR_TEMPLATE_ID;
const parseOcrTemplates = (value) => String(value || '')
    .split(',')
    .map((entry) => {
        const separatorIndex = entry.lastIndexOf(':');
        if (separatorIndex <= 0) return null;
        const name = entry.slice(0, separatorIndex).trim();
        const id = Number(entry.slice(separatorIndex + 1).trim());
        return name && Number.isInteger(id) && id > 0 ? { id, name } : null;
    })
    .filter(Boolean);
const CLOVA_OCR_TEMPLATES = parseOcrTemplates(process.env.CLOVA_OCR_TEMPLATES);
if (CLOVA_OCR_TEMPLATES.length === 0) {
    const defaultTemplateId = Number(CLOVA_OCR_TEMPLATE_ID);
    if (Number.isInteger(defaultTemplateId) && defaultTemplateId > 0) {
        CLOVA_OCR_TEMPLATES.push({ id: defaultTemplateId, name: '기본 템플릿' });
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- Discord Client Setup ---
let discordClient = null;
let discordChannelId = null;
let isDiscordEnabled = true;

function initDiscordBot(token, channelId) {
    if (discordClient) {
        discordClient.destroy();
    }
    discordChannelId = channelId;
    // ONLY Guilds intent: This prevents the bot from receiving message events entirely.
    // Ensure 'Message Content Intent' is also OFF in Discord Portal.
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

    discordClient.once('clientReady', () => {
        // Log removed
    });

    discordClient.login(token).catch(err => {
        discordClient = null;
    });
}

const notifiedBosses = new Set();
setInterval(() => {
    const isBotReady = discordClient && discordClient.isReady();
    if (!isBotReady || !discordChannelId) return;

    const now = Date.now();
    // Search window: up to 6 minutes from now
    const windowMax = now + 6 * 60 * 1000;
    const windowMin = now;

    db.all("SELECT id, boss, type, spawnTime FROM boss_schedules WHERE spawnTime > ? AND spawnTime <= ?", [windowMin, windowMax], (err, bosses) => {
        if (err) {
            return;
        }
        if (bosses && bosses.length > 0) {
            bosses.forEach(b => {
                const diffMin = (b.spawnTime - now) / (60 * 1000);
                let alertType = null;
                let content = '';

                // 5-minute alert (4.75m ~ 5.25m) - 30s window centered at 5.0
                if (diffMin > 4.75 && diffMin <= 5.25) {
                    alertType = '5min';
                    content = `${b.type} ${b.boss} 5분 전입니다.`;
                }
                // 1-minute alert (0.75m ~ 1.25m) - 30s window centered at 1.0
                else if (diffMin > 0.75 && diffMin <= 1.25) {
                    alertType = '1min';
                    content = `${b.type} ${b.boss} 1분 전입니다.`;
                }
                // Spawn alert (-0.25m ~ 0.25m) - 30s window centered at 0.0
                else if (diffMin > -0.25 && diffMin <= 0.25) {
                    alertType = 'spawn';
                    content = `${b.type} ${b.boss} 타임입니다.`;
                }

                if (alertType && isDiscordEnabled) {
                    const notifyKey = `${b.id}_${alertType}`;
                    if (!notifiedBosses.has(notifyKey)) {
                        discordClient.channels.fetch(discordChannelId)
                            .then(channel => {
                                if (channel) {
                                    channel.send({ content, tts: true }).then(() => {
                                        notifiedBosses.add(notifyKey);
                                        // Auto cleanup after 15 mins
                                        setTimeout(() => notifiedBosses.delete(notifyKey), 15 * 60 * 1000);
                                    }).catch(e => { });
                                }
                            }).catch(err => { });
                    }
                }
            });
        }
    });
}, 30000);

// --- Public API ---
app.get('/api/time', (req, res) => {
    res.json({ serverTime: Date.now(), timeZone: 'Asia/Seoul' });
});

// --- Auth Routes ---
const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        // Error opening database
    } else {
        // Enforce FK constraints/cascades in SQLite for this connection.
        db.run("PRAGMA foreign_keys = ON", () => initDB());
    }
});

function initDB() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
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

        // Alternate characters are stored separately so existing user records
        // remain untouched. Only one alternate character is allowed per user.
        db.run(`CREATE TABLE IF NOT EXISTS user_alternate_characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            character_name TEXT NOT NULL,
            main_class TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, character_name),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_alternate_characters_user
            ON user_alternate_characters(user_id, sort_order, id)`);
        // Keep the earliest existing alternate character before enforcing the
        // new one-character-per-user rule.
        db.run(`DELETE FROM user_alternate_characters
            WHERE EXISTS (
                SELECT 1
                FROM user_alternate_characters AS earlier
                WHERE earlier.user_id = user_alternate_characters.user_id
                  AND (
                    earlier.sort_order < user_alternate_characters.sort_order
                    OR (
                        earlier.sort_order = user_alternate_characters.sort_order
                        AND earlier.id < user_alternate_characters.id
                    )
                  )
            )`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_alternate_characters_one_per_user
            ON user_alternate_characters(user_id)`);

        // Migration: Add new columns if they don't exist
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err || !columns) return;
            const hasCritRate = columns.some(c => c.name === 'max_crit_rate');
            const hasCritResist = columns.some(c => c.name === 'max_crit_resist');
            const hasStatusAcc = columns.some(c => c.name === 'status_effect_acc');

            if (!hasCritRate) db.run("ALTER TABLE users ADD COLUMN max_crit_rate INTEGER DEFAULT 0");
            if (!hasCritResist) db.run("ALTER TABLE users ADD COLUMN max_crit_resist INTEGER DEFAULT 0");
            if (!hasStatusAcc) db.run("ALTER TABLE users ADD COLUMN status_effect_acc INTEGER DEFAULT 0");
        });

        // Invitations Table
        db.run(`CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE,
            role TEXT,
            created_by INTEGER,
            is_used INTEGER DEFAULT 0,
            expires_at DATETIME
        )`);

        // Boss Schedules Table
        db.run(`CREATE TABLE IF NOT EXISTS boss_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            region TEXT,
            boss TEXT,
            spawnTime INTEGER,
            created_by INTEGER,
            is_mung INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // Migration: Add is_mung column if it doesn't exist (for existing DBs)
            db.all("PRAGMA table_info(boss_schedules)", (err, columns) => {
                if (err) return;
                const hasMung = columns.some(c => c.name === 'is_mung');
                if (!hasMung) {
                    db.run("ALTER TABLE boss_schedules ADD COLUMN is_mung INTEGER DEFAULT 0");
                }
            });
        });

        // User Item Collections Table
        db.run(`CREATE TABLE IF NOT EXISTS user_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            collection_name TEXT,
            UNIQUE(user_id, collection_name)
        )`);

        // Stable item IDs replace the legacy collection-name based check keys.
        // The legacy table is intentionally retained so migration can be audited
        // and rolled back without losing the original records.
        db.run(`CREATE TABLE IF NOT EXISTS collection_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            part TEXT NOT NULL,
            enchantment TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            legacy_key TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            UNIQUE(collection_id, legacy_key, sort_order)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_collection_items (
            user_id INTEGER NOT NULL,
            collection_item_id INTEGER NOT NULL,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, collection_item_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (collection_item_id) REFERENCES collection_items(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS app_migrations (
            name TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            details TEXT
        )`);

        // Participation Targets Table
        db.run(`CREATE TABLE IF NOT EXISTS participation_targets (
            boss TEXT PRIMARY KEY
        )`);

        // Boss Participants Table
        db.run(`CREATE TABLE IF NOT EXISTS boss_participants (
            boss TEXT,
            nickname TEXT,
            PRIMARY KEY (boss, nickname)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS boss_vote_participants (
            vote_key TEXT,
            boss TEXT,
            spawnTime INTEGER,
            user_id INTEGER,
            nickname TEXT,
            status TEXT DEFAULT 'joined',
            excluded_by INTEGER,
            excluded_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (vote_key, user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`, () => {
            db.all("PRAGMA table_info(boss_vote_participants)", (err, columns) => {
                if (err) return;
                const names = columns.map(c => c.name);
                if (!names.includes('status')) db.run("ALTER TABLE boss_vote_participants ADD COLUMN status TEXT DEFAULT 'joined'");
                if (!names.includes('excluded_by')) db.run("ALTER TABLE boss_vote_participants ADD COLUMN excluded_by INTEGER");
                if (!names.includes('excluded_at')) db.run("ALTER TABLE boss_vote_participants ADD COLUMN excluded_at DATETIME");
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS boss_vote_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT DEFAULT '투표',
            region TEXT DEFAULT '수동',
            boss TEXT,
            spawnTime INTEGER,
            is_blessed INTEGER DEFAULT 0,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )`, () => {
            db.all("PRAGMA table_info(boss_vote_events)", (err, columns) => {
                if (err) return;
                const hasBlessed = columns.some(c => c.name === 'is_blessed');
                if (!hasBlessed) {
                    db.run("ALTER TABLE boss_vote_events ADD COLUMN is_blessed INTEGER DEFAULT 0");
                }
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS boss_vote_event_states (
            vote_key TEXT PRIMARY KEY,
            boss TEXT,
            spawnTime INTEGER,
            state TEXT DEFAULT 'ACTIVE',
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            db.all("PRAGMA table_info(boss_vote_event_states)", (err, columns) => {
                if (err) return;
                const names = columns.map(c => c.name);
                if (!names.includes('boss')) db.run("ALTER TABLE boss_vote_event_states ADD COLUMN boss TEXT");
                if (!names.includes('spawnTime')) db.run("ALTER TABLE boss_vote_event_states ADD COLUMN spawnTime INTEGER");
                if (!names.includes('state')) db.run("ALTER TABLE boss_vote_event_states ADD COLUMN state TEXT DEFAULT 'ACTIVE'");
                if (!names.includes('updated_by')) db.run("ALTER TABLE boss_vote_event_states ADD COLUMN updated_by INTEGER");
                if (!names.includes('updated_at')) db.run("ALTER TABLE boss_vote_event_states ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP");
            });
        });

        // Content Groups Table (New)
        db.run(`CREATE TABLE IF NOT EXISTS content_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Group Members Table (New)
        db.run(`CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (group_id, user_id),
            FOREIGN KEY (group_id) REFERENCES content_groups(id) ON DELETE CASCADE
        )`);

        // Siege Participation Data Table (New)
        db.run(`CREATE TABLE IF NOT EXISTS siege_data (
            user_id INTEGER PRIMARY KEY,
            current_diamonds INTEGER DEFAULT 0,
            remaining_diamonds INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Excluded Members Table (For item distribution priority)
        db.run(`CREATE TABLE IF NOT EXISTS excluded_members (
            user_id INTEGER PRIMARY KEY,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Hand Support Requests: matchmaking only, no login credentials stored.
        db.run(`CREATE TABLE IF NOT EXISTS support_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_id INTEGER NOT NULL,
            requested_time TEXT,
            memo TEXT,
            status TEXT DEFAULT 'OPEN',
            selected_application_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS support_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER NOT NULL,
            applicant_id INTEGER NOT NULL,
            memo TEXT,
            status TEXT DEFAULT 'APPLIED',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(request_id, applicant_id),
            FOREIGN KEY (request_id) REFERENCES support_requests(id) ON DELETE CASCADE,
            FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Settings Table (Renamed to odin_settings to avoid conflict with existing tables)
        db.run(`CREATE TABLE IF NOT EXISTS odin_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_name TEXT DEFAULT '오딘 길드',
            discord_token TEXT,
            discord_channel_id TEXT,
            discord_enabled INTEGER DEFAULT 1,
            allow_member_combat_power_edit INTEGER DEFAULT 1
        )`, () => {
            // Migration: Add discord_enabled to existing odin_settings table if it doesn't exist
            db.all("PRAGMA table_info(odin_settings)", (err, rows) => {
                if (rows && !rows.find(r => r.name === 'discord_enabled')) {
                    db.run("ALTER TABLE odin_settings ADD COLUMN discord_enabled INTEGER DEFAULT 1");
                }
                if (rows && !rows.find(r => r.name === 'allow_member_combat_power_edit')) {
                    db.run("ALTER TABLE odin_settings ADD COLUMN allow_member_combat_power_edit INTEGER DEFAULT 1");
                }

                // CRITICAL: Ensure at least one row exists
                db.get("SELECT count(*) as cnt FROM odin_settings", (err, row) => {
                    if (row && row.cnt === 0) {
                        db.run("INSERT INTO odin_settings (guild_name, discord_enabled, allow_member_combat_power_edit) VALUES ('오딘 길드', 1, 1)");
                    }
                });
            });
        });

        // Notice: Guild Rules
        db.run(`CREATE TABLE IF NOT EXISTS guild_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            color TEXT DEFAULT '#f8fafc',
            sort_order INTEGER DEFAULT 0,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run("ALTER TABLE guild_rules ADD COLUMN color TEXT DEFAULT '#f8fafc'", () => {});
        db.run("ALTER TABLE guild_rules ADD COLUMN sort_order INTEGER DEFAULT 0", () => {});

        // Notice: Boss Control Matrix
        db.run(`CREATE TABLE IF NOT EXISTS boss_control_states (
            chapter TEXT NOT NULL,
            boss TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'NONE',
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (chapter, boss)
        )`);

        // Notice: Price List
        db.run(`CREATE TABLE IF NOT EXISTS price_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            item_name TEXT NOT NULL,
            price TEXT NOT NULL,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Notice: Price Guide (Card/Section-based; same style as guild rules)
        db.run(`CREATE TABLE IF NOT EXISTS price_guides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            color TEXT DEFAULT '#f8fafc',
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run("ALTER TABLE price_guides ADD COLUMN color TEXT DEFAULT '#f8fafc'", () => {});

        // Boss Definitions Table (Replaces custom_bosses)
        db.run(`CREATE TABLE IF NOT EXISTS boss_definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT,
            region TEXT,
            boss TEXT,
            cooldown INTEGER,
            timeStr TEXT,
            days TEXT,
            color TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // Add color and sort_order column if not exists
            db.run("ALTER TABLE boss_definitions ADD COLUMN color TEXT", (err) => {});
            db.run("ALTER TABLE boss_definitions ADD COLUMN sort_order INTEGER DEFAULT 0", (err) => {});

            // Migration
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_bosses'", (err, row) => {
                if (row) {
                    db.get("SELECT COUNT(*) as cnt FROM custom_bosses", (err, cntRow) => {
                        if (cntRow && cntRow.cnt > 0) {
                            db.run("INSERT INTO boss_definitions (type, region, boss, cooldown, timeStr, days, created_at) SELECT type, region, boss, cooldown, timeStr, days, created_at FROM custom_bosses", () => {
                                db.run("DROP TABLE custom_bosses");
                                seedDefaultBosses();
                            });
                        } else {
                            db.run("DROP TABLE custom_bosses");
                            checkAndSeedDefaultBosses();
                        }
                    });
                } else {
                    checkAndSeedDefaultBosses();
                }
            });
        });

        // Discord Bot Auth - Try auto-login
        setTimeout(() => {
            db.get("SELECT discord_token, discord_channel_id, discord_enabled FROM odin_settings LIMIT 1", (err, row) => {
                if (row && row.discord_token && row.discord_channel_id) {
                    isDiscordEnabled = parseInt(row.discord_enabled) === 1;
                    initDiscordBot(row.discord_token, row.discord_channel_id);
                }
            });
        }, 1000);

        // Collections Metadata Table
        db.run(`CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            items TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Collections table initialization failed:', err.message);
                return process.exit(1);
            }

            db.get("SELECT COUNT(*) as count FROM collections", (countErr, row) => {
                if (countErr) {
                    console.error('Collections count failed:', countErr.message);
                    return process.exit(1);
                }

                const migrate = () => {
                    migrateCollectionItemIds()
                        .then(startHttpServer)
                        .catch((migrationErr) => {
                            console.error('Collection item ID migration failed:', migrationErr.message);
                            process.exit(1);
                        });
                };

                if (!row || row.count > 0) return migrate();

                try {
                    const dataPath = path.join(__dirname, 'collections_data.js');
                    if (!fs.existsSync(dataPath)) return migrate();

                    const content = fs.readFileSync(dataPath, 'utf8');
                    const startIdx = content.indexOf('[');
                    const endIdx = content.lastIndexOf(']');
                    if (startIdx === -1 || endIdx === -1) return migrate();

                    const collections = JSON.parse(content.substring(startIdx, endIdx + 1));
                    const stmt = db.prepare("INSERT INTO collections (name, items) VALUES (?, ?)");
                    collections.forEach(c => stmt.run([c.name, JSON.stringify(c.items)]));
                    stmt.finalize((seedErr) => {
                        if (seedErr) console.error('Collections seed failed:', seedErr.message);
                        migrate();
                    });
                } catch (seedErr) {
                    console.error('Collections seed failed:', seedErr.message);
                    migrate();
                }
            });
        });

        // Initial Master
        db.get("SELECT * FROM users WHERE role = 'MASTER'", (err, row) => {
            if (!row) {
                const hash = bcrypt.hashSync('password123', 10);
                db.run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", ['master', hash, 'MASTER']);
            }
        });
    });
}

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const parseLegacyCollectionItems = (collection) => {
    let rawItems;
    try {
        rawItems = JSON.parse(collection.items || '[]');
    } catch (_) {
        rawItems = [];
    }

    const seenCounts = {};
    return rawItems.map((rawItem, sortOrder) => {
        const fullItem = String(rawItem);
        const [part = '', enchantment = ''] = fullItem.split('|').map(value => value.trim());
        const countKey = fullItem.trim();
        seenCounts[countKey] = (seenCounts[countKey] || 0) + 1;

        let legacyKey = `${collection.name}||${part}||${enchantment}`;
        if (seenCounts[countKey] > 1) legacyKey += `||${seenCounts[countKey]}`;

        return { part, enchantment, sortOrder, legacyKey };
    }).filter(item => item.part && item.enchantment);
};

async function migrateCollectionItemIds() {
    const migrationName = '2026-collection-item-ids-v1';
    const alreadyApplied = await dbGet("SELECT name FROM app_migrations WHERE name = ?", [migrationName]);
    if (alreadyApplied) return;

    const collections = await dbAll("SELECT id, name, items FROM collections ORDER BY id ASC");

    try {
        for (const collection of collections) {
            for (const item of parseLegacyCollectionItems(collection)) {
                await dbRun(
                    `INSERT OR IGNORE INTO collection_items
                        (collection_id, part, enchantment, sort_order, legacy_key, is_active)
                     VALUES (?, ?, ?, ?, ?, 1)`,
                    [collection.id, item.part, item.enchantment, item.sortOrder, item.legacyKey]
                );
            }
        }

        await dbRun(`
            INSERT OR IGNORE INTO user_collection_items (user_id, collection_item_id)
            SELECT uc.user_id, ci.id
            FROM user_collections uc
            JOIN collection_items ci ON ci.legacy_key = uc.collection_name
        `);

        const legacyCount = await dbGet("SELECT COUNT(*) AS count FROM user_collections");
        const migratedCount = await dbGet(`
            SELECT COUNT(*) AS count
            FROM user_collections uc
            WHERE EXISTS (
                SELECT 1 FROM collection_items ci WHERE ci.legacy_key = uc.collection_name
            )
        `);
        const unmatchedCount = Math.max(0, legacyCount.count - migratedCount.count);
        const details = JSON.stringify({
            legacyChecks: legacyCount.count,
            matchedLegacyChecks: migratedCount.count,
            unmatchedLegacyChecks: unmatchedCount
        });

        await dbRun(
            "INSERT INTO app_migrations (name, details) VALUES (?, ?)",
            [migrationName, details]
        );

        console.log(
            `Collection item migration complete: ${migratedCount.count}/${legacyCount.count} legacy checks matched`
        );
        if (unmatchedCount > 0) {
            console.warn(
                `${unmatchedCount} legacy collection checks could not be matched and remain in user_collections`
            );
        }
    } catch (err) {
        throw err;
    }
}

const BOSS_TIMERS = {
    "4층분노의모네가름": 12, "스칼라니르": 12, "니드호그": 12, "라이노르": 12, "라타토스크": 12, "바우티": 12, "야른": 12, "브륀힐드": 12, "비요른": 12, "셀로비아": 12, "수드리": 12, "페티": 12, "파르바": 12, "헤르모드": 12, "흐니르": 12,
    "7층나태의드라우그": 24, "굴베이그": 24, "두라스로르": 24, "드라우그": 24, "스바르트": 24, "모네가름": 24,
    "우로보로스": 36, "10층다인홀로크": 36, "최하층강글": 36, "메기르": 36, "탕그리스니르": 36, "최하층굴베": 36, "헤르가름": 36, "신마라": 36, "엘드룬": 36,
    "발리": 48, "샤무크": 48, "스칼드메르": 48, "노트": 48, "그로아": 48,
    "헤이드": 60, "호드": 60, "히로킨": 60,
    "수르트": 72, "오딘": 72, "최하층스네르": 72, "토르": 72, "티르": 72, "미미르": 72,
    "이미르": 120
};

const DEFAULT_BOSS_DATA = [
    { type: '공통', regions: [{ name: '던전', bosses: ['4층분노의모네가름', '7층나태의드라우그', '10층다인홀로크', '최하층강글', '최하층굴베', '최하층스네르'] }] },
    { type: '침공', regions: [
        { name: '요툰하임', bosses: ['파르바', '흐니르', '셀로비아', '니드호그', '바우티', '페티', '야른', '티르'] },
        { name: '니다벨리르', bosses: ['라이노르', '라타토스크', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '수드리', '토르'] },
        { name: '알브하임', bosses: ['스바르트', '모네가름', '두라스로르', '드라우그', '굴베이그', '오딘'] },
        { name: '무스펠', bosses: ['신마라', '메기르', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스', '수르트'] },
        { name: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아', '미미르'] },
        { name: '니플하임', bosses: ['히로킨', '호드', '헤이드', '이미르'] },
    ]},
    { type: '본섭', regions: [
        { name: '요툰하임', bosses: ['파르바', '흐니르', '셀로비아', '니드호그', '바우티', '페티', '야른', '티르'] },
        { name: '니다벨리르', bosses: ['라이노르', '라타토스크', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '수드리', '토르'] },
        { name: '알브하임', bosses: ['스바르트', '모네가름', '두라스로르', '드라우그', '굴베이그', '오딘'] },
        { name: '무스펠', bosses: ['신마라', '메기르', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스', '수르트'] },
        { name: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아', '미미르'] },
        { name: '니플하임', bosses: ['히로킨', '호드', '헤이드', '이미르'] },
    ]}
];

const DEFAULT_FIXED_EVENTS = [
    { type: '고정', region: '공통', boss: '월드 보스', timeStr: '12:00:00', days: '월,화,수,목,금,토,일' },
    { type: '고정', region: '공통', boss: '월드 보스', timeStr: '20:00:00', days: '월,화,수,목,금,토,일' },
    { type: '고정', region: '공통', boss: '정예몬스터', timeStr: '19:00:00', days: '월,화,수,목,금,토,일' },
    { type: '고정', region: '공통', boss: '니다 닻', timeStr: '18:30:00', days: '수' },
    { type: '고정', region: '공통', boss: '알브 닻', timeStr: '20:30:00', days: '수' },
    { type: '고정', region: '공통', boss: '성채보스', timeStr: '21:30:00', days: '화,목' },
    { type: '고정', region: '공통', boss: '무스펠 닻', timeStr: '22:30:00', days: '수' },
    { type: '고정', region: '공통', boss: '지옥성채보스', timeStr: '22:30:00', days: '목' }
];

function seedDefaultBosses() {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("INSERT INTO boss_definitions (type, region, boss, cooldown, timeStr, days, color) VALUES (?, ?, ?, ?, ?, ?, ?)");
        
        DEFAULT_BOSS_DATA.forEach(cat => {
            cat.regions.forEach(reg => {
                reg.bosses.forEach(boss => {
                    const cd = BOSS_TIMERS[boss] || 0;
                    stmt.run(cat.type, reg.name, boss, cd, null, null, null);
                });
            });
        });
        
        DEFAULT_FIXED_EVENTS.forEach(fe => {
            stmt.run(fe.type, fe.region, fe.boss, 0, fe.timeStr, fe.days, null);
        });
        
        stmt.finalize();
        db.run("COMMIT");
    });
}

function checkAndSeedDefaultBosses() {
    db.get("SELECT COUNT(*) as count FROM boss_definitions", (err, row) => {
        if (row && row.count === 0) {
            seedDefaultBosses();
        }
    });
}

function cleanupSupportRequests() {
    db.run(`
        DELETE FROM support_requests
        WHERE
            (status IN ('DONE', 'CANCELED') AND datetime(updated_at) <= datetime('now', '-2 days'))
            OR substr(requested_time, 1, 10) <= date('now', '-7 days')
    `);
}

setInterval(cleanupSupportRequests, 24 * 60 * 60 * 1000);
setTimeout(cleanupSupportRequests, 2000);

// --- Middleware ---
const verifyToken = (req, res, next) => {
    const header = req.headers['authorization'];
    if (!header) return res.status(403).json({ error: 'No token provided.' });
    const token = header.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Failed to authenticate token.' });
        req.userId = decoded.id;
        req.userRole = decoded.role;
        req.userNickname = decoded.nickname;
        req.userName = decoded.username;
        next();
    });
};

// OCR is deliberately serialized: the Micro instance only relays one optimized
// image at a time and never writes the screenshot to disk.
let isBossOcrProcessing = false;

app.get('/api/ocr/templates', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') {
        return res.status(403).json({ error: '스크린샷 분석 기능은 길드장만 사용할 수 있습니다.' });
    }
    res.json({ templates: CLOVA_OCR_TEMPLATES });
});

app.post('/api/ocr/boss-schedule', verifyToken, express.raw({ type: ['image/jpeg', 'image/png'], limit: '5mb' }), async (req, res) => {
    if (req.userRole !== 'MASTER') {
        return res.status(403).json({ error: '스크린샷 분석 기능은 길드장만 사용할 수 있습니다.' });
    }
    if (!CLOVA_OCR_INVOKE_URL || !CLOVA_OCR_SECRET || CLOVA_OCR_TEMPLATES.length === 0) {
        return res.status(503).json({ error: 'CLOVA Template OCR 환경변수가 설정되지 않았습니다.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'OCR 이미지가 필요합니다.' });
    }
    if (isBossOcrProcessing) {
        return res.status(429).json({ error: '다른 스크린샷을 분석 중입니다. 잠시 후 다시 시도해주세요.' });
    }

    const contentType = req.headers['content-type'] === 'image/png' ? 'image/png' : 'image/jpeg';
    const imageFormat = contentType === 'image/png' ? 'png' : 'jpg';
    const requestedTemplateId = Number(req.get('X-OCR-TEMPLATE-ID'));
    const selectedTemplate = CLOVA_OCR_TEMPLATES.find(template => template.id === requestedTemplateId);
    if (!selectedTemplate) {
        return res.status(400).json({ error: '선택한 OCR 템플릿을 찾을 수 없습니다.' });
    }

    isBossOcrProcessing = true;
    try {
        const form = new FormData();
        const message = {
            version: 'V2',
            requestId: crypto.randomUUID(),
            timestamp: Date.now(),
            lang: 'ko',
            images: [{
                format: imageFormat,
                name: 'boss-schedule',
                templateIds: [selectedTemplate.id]
            }]
        };
        form.append('message', JSON.stringify(message));
        form.append('file', new Blob([req.body], { type: contentType }), `boss-schedule.${imageFormat}`);

        const response = await fetch(CLOVA_OCR_INVOKE_URL, {
            method: 'POST',
            headers: { 'X-OCR-SECRET': CLOVA_OCR_SECRET },
            body: form,
            signal: AbortSignal.timeout(20000)
        });
        const responseText = await response.text();
        let responseBody;
        try {
            responseBody = JSON.parse(responseText);
        } catch (error) {
            return res.status(502).json({ error: 'CLOVA OCR 응답을 해석할 수 없습니다.' });
        }
        if (!response.ok) {
            return res.status(response.status >= 400 && response.status < 500 ? response.status : 502)
                .json({ error: responseBody.message || 'CLOVA OCR 분석에 실패했습니다.' });
        }
        res.json(responseBody);
    } catch (error) {
        const message = error.name === 'TimeoutError' ? 'OCR 분석 시간이 초과되었습니다.' : 'OCR 서버 연결에 실패했습니다.';
        res.status(502).json({ error: message });
    } finally {
        isBossOcrProcessing = false;
    }
});

// --- AUTH API ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials.' });
        const isValid = bcrypt.compareSync(password, user.password_hash);
        if (!isValid) return res.status(401).json({ error: 'Invalid credentials.' });
        const token = jwt.sign({ id: user.id, role: user.role, username: user.username, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, role: user.role, username: user.username, userId: user.id, nickname: user.nickname });
    });
});
app.post('/api/invites', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { targetRole } = req.body;
    // Allow Admins to also generate Admin invites if requested (User said "entire" menu should be visible)
    if (targetRole === 'ADMIN' && req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Only Master or Admin can invite.' });
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);
    db.run("INSERT INTO invitations (token, role, created_by, expires_at) VALUES (?, ?, ?, ?)", [token, targetRole || 'MEMBER', req.userId, expiresAt.toISOString()], (err) => {
        if (err) return res.status(500).json({ error: 'Error generating invite.' });
        res.json({ inviteToken: token, role: targetRole || 'MEMBER' });
    });
});

app.post('/api/users/register', (req, res) => {
    const { token, username, password, nickname, occupation, main_class, combat_power, equipment, skills, max_crit_rate, max_crit_resist, status_effect_acc } = req.body;
    if (!username || !password || !nickname) return res.status(400).json({ error: 'Missing required fields.' });
    db.get("SELECT * FROM invitations WHERE token = ? AND is_used = 0", [token], (err, invite) => {
        if (err || !invite) return res.status(400).json({ error: 'Invalid token.' });
        const hash = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (username, password_hash, role, nickname, occupation, main_class, combat_power, equipment, skills, max_crit_rate, max_crit_resist, status_effect_acc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hash, invite.role, nickname, occupation, main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills), max_crit_rate || 0, max_crit_resist || 0, status_effect_acc || 0], function (err) {
                if (err) return res.status(400).json({ error: 'Username exists.' });
                db.run("UPDATE invitations SET is_used = 1 WHERE token = ?", [token]);
                res.json({ success: true });
            });
    });
});

app.get('/api/users/me', verifyToken, async (req, res) => {
    try {
        const row = await dbGet("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills, max_crit_rate, max_crit_resist, status_effect_acc FROM users WHERE id = ?", [req.userId]);
        if (!row) return res.status(404).json({ error: 'User not found.' });

        row.alternate_characters = await dbAll(
            `SELECT id, character_name, main_class
             FROM user_alternate_characters
             WHERE user_id = ?
             ORDER BY sort_order ASC, id ASC`,
            [req.userId]
        );
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const normalizeAlternateCharacters = (value) => {
    if (!Array.isArray(value)) return [];
    if (value.length > 1) throw new Error('부계정은 1개만 등록할 수 있습니다.');

    return value.map((character, index) => {
        const characterName = String(character?.character_name || '').trim();
        const mainClass = String(character?.main_class || '').trim();
        if (!characterName && !mainClass) return null;
        if (!characterName || !mainClass) throw new Error('부계정의 캐릭터명과 주클래스를 모두 입력해 주세요.');
        if (characterName.length > 30 || mainClass.length > 30) throw new Error('부계정 정보는 항목당 30자 이내로 입력해 주세요.');

        return { characterName, mainClass, sortOrder: index };
    }).filter(Boolean);
};

app.put('/api/users/me', verifyToken, async (req, res) => {
    const { password, nickname, occupation, main_class, combat_power, equipment, skills, max_crit_rate, max_crit_resist, status_effect_acc } = req.body;
    const shouldUpdateAlternateCharacters = Object.prototype.hasOwnProperty.call(req.body, 'alternate_characters');
    let alternateCharacters;

    try {
        alternateCharacters = shouldUpdateAlternateCharacters
            ? normalizeAlternateCharacters(req.body.alternate_characters)
            : [];
    } catch (validationErr) {
        return res.status(400).json({ error: validationErr.message });
    }

    try {
        const user = await dbGet("SELECT combat_power FROM users WHERE id = ?", [req.userId]);
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const settings = await dbGet("SELECT allow_member_combat_power_edit FROM odin_settings LIMIT 1");
        const allowCombatPowerEdit = !settings || settings.allow_member_combat_power_edit !== 0;
        const nextCombatPower = allowCombatPowerEdit ? combat_power : user.combat_power;
        let sql = `UPDATE users SET nickname = ?, occupation = ?, main_class = ?, combat_power = ?, equipment = ?, skills = ?, max_crit_rate = ?, max_crit_resist = ?, status_effect_acc = ?`;
        const params = [nickname, occupation, main_class, nextCombatPower, JSON.stringify(equipment), JSON.stringify(skills), max_crit_rate || 0, max_crit_resist || 0, status_effect_acc || 0];
        if (password && password.trim() !== "") {
            params.push(bcrypt.hashSync(password, 10));
            sql += `, password_hash = ?`;
        }
        sql += ` WHERE id = ?`;
        params.push(req.userId);

        await dbRun("BEGIN TRANSACTION");
        try {
            await dbRun(sql, params);
            if (shouldUpdateAlternateCharacters) {
                await dbRun("DELETE FROM user_alternate_characters WHERE user_id = ?", [req.userId]);
                for (const character of alternateCharacters) {
                    await dbRun(
                        `INSERT INTO user_alternate_characters (user_id, character_name, main_class, sort_order)
                         VALUES (?, ?, ?, ?)`,
                        [req.userId, character.characterName, character.mainClass, character.sortOrder]
                    );
                }
            }
            await dbRun("COMMIT");
            res.json({ success: true });
        } catch (txErr) {
            try { await dbRun("ROLLBACK"); } catch (_) { }
            throw txErr;
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users', verifyToken, async (req, res) => {
    try {
        const users = await dbAll("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills, max_crit_rate, max_crit_resist, status_effect_acc FROM users");
        const alternateCharacters = await dbAll(
            `SELECT id, user_id, character_name, main_class
             FROM user_alternate_characters
             ORDER BY user_id ASC, sort_order ASC, id ASC`
        );
        const charactersByUser = new Map();
        alternateCharacters.forEach(character => {
            if (!charactersByUser.has(character.user_id)) charactersByUser.set(character.user_id, []);
            charactersByUser.get(character.user_id).push({
                id: character.id,
                character_name: character.character_name,
                main_class: character.main_class
            });
        });
        users.forEach(user => {
            user.alternate_characters = charactersByUser.get(user.id) || [];
        });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- HAND SUPPORT API ---
const isAdminRole = (role) => role === 'MASTER' || role === 'ADMIN';

const supportRequestSelect = `
    SELECT
        sr.id,
        sr.requester_id AS requesterId,
        sr.requested_time AS requestedTime,
        sr.memo,
        sr.status,
        sr.selected_application_id AS selectedApplicationId,
        sr.created_at AS createdAt,
        sr.updated_at AS updatedAt,
        u.nickname,
        u.occupation,
        u.main_class AS mainClass,
        u.combat_power AS combatPower
    FROM support_requests sr
    JOIN users u ON u.id = sr.requester_id
`;

app.get('/api/support-requests', verifyToken, (req, res) => {
    db.all(`${supportRequestSelect} ORDER BY CASE sr.status WHEN 'OPEN' THEN 0 WHEN 'MATCHED' THEN 1 ELSE 2 END, sr.created_at DESC`, (err, requests) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`
            SELECT
                sa.id,
                sa.request_id AS requestId,
                sa.applicant_id AS applicantId,
                sa.memo,
                sa.status,
                sa.created_at AS createdAt,
                u.nickname,
                u.occupation,
                u.main_class AS mainClass,
                u.combat_power AS combatPower
            FROM support_applications sa
            JOIN users u ON u.id = sa.applicant_id
            ORDER BY sa.created_at ASC
        `, (appErr, applications) => {
            if (appErr) return res.status(500).json({ error: appErr.message });
            const applicationsByRequest = {};
            (applications || []).forEach(appRow => {
                if (!applicationsByRequest[appRow.requestId]) applicationsByRequest[appRow.requestId] = [];
                applicationsByRequest[appRow.requestId].push(appRow);
            });

            res.json((requests || []).map(row => ({
                ...row,
                applications: applicationsByRequest[row.id] || []
            })));
        });
    });
});

app.post('/api/support-requests', verifyToken, (req, res) => {
    const requestedTime = String(req.body?.requestedTime || '').trim();
    const memo = String(req.body?.memo || '').trim();
    if (!requestedTime) return res.status(400).json({ error: '요청시간을 입력해주세요.' });

    db.run(
        "INSERT INTO support_requests (requester_id, requested_time, memo) VALUES (?, ?, ?)",
        [req.userId, requestedTime.slice(0, 80), memo.slice(0, 500)],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.put('/api/support-requests/:id/status', verifyToken, (req, res) => {
    const requestId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const allowedStatuses = new Set(['OPEN', 'DONE', 'CANCELED']);
    if (!Number.isFinite(requestId) || !allowedStatuses.has(status)) {
        return res.status(400).json({ error: 'Invalid request.' });
    }

    db.get("SELECT requester_id FROM support_requests WHERE id = ?", [requestId], (err, requestRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requestRow) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        if (requestRow.requester_id !== req.userId && !isAdminRole(req.userRole)) {
            return res.status(403).json({ error: '요청자 또는 운영진만 변경할 수 있습니다.' });
        }

        db.run(
            "UPDATE support_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [status, requestId],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                res.json({ success: true });
            }
        );
    });
});

app.delete('/api/support-requests/:id', verifyToken, (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request.' });

    db.get("SELECT requester_id FROM support_requests WHERE id = ?", [requestId], (err, requestRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requestRow) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        if (requestRow.requester_id !== req.userId && !isAdminRole(req.userRole)) {
            return res.status(403).json({ error: '요청자 또는 운영진만 삭제할 수 있습니다.' });
        }

        db.run("DELETE FROM support_requests WHERE id = ?", [requestId], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });
            res.json({ success: true });
        });
    });
});

app.post('/api/support-requests/:id/applications', verifyToken, (req, res) => {
    const requestId = Number(req.params.id);
    const memo = String(req.body?.memo || '').trim();
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: 'Invalid request.' });

    db.get("SELECT requester_id, status FROM support_requests WHERE id = ?", [requestId], (err, requestRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requestRow) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        if (requestRow.status !== 'OPEN') return res.status(400).json({ error: '신청 가능한 요청이 아닙니다.' });
        if (requestRow.requester_id === req.userId) return res.status(400).json({ error: '본인 요청에는 신청할 수 없습니다.' });

        db.run(
            "INSERT INTO support_applications (request_id, applicant_id, memo) VALUES (?, ?, ?)",
            [requestId, req.userId, memo.slice(0, 300)],
            function (insertErr) {
                if (insertErr) {
                    const isDuplicate = insertErr.message && insertErr.message.includes('UNIQUE');
                    return res.status(isDuplicate ? 400 : 500).json({ error: isDuplicate ? '이미 신청한 요청입니다.' : insertErr.message });
                }
                res.json({ success: true, id: this.lastID });
            }
        );
    });
});

app.delete('/api/support-requests/:requestId/applications/:applicationId', verifyToken, (req, res) => {
    const requestId = Number(req.params.requestId);
    const applicationId = Number(req.params.applicationId);
    if (!Number.isFinite(requestId) || !Number.isFinite(applicationId)) return res.status(400).json({ error: 'Invalid request.' });

    db.get(
        "SELECT applicant_id, status FROM support_applications WHERE id = ? AND request_id = ?",
        [applicationId, requestId],
        (err, appRow) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!appRow) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });
            if (appRow.applicant_id !== req.userId) return res.status(403).json({ error: '본인 신청만 취소할 수 있습니다.' });

            db.run("DELETE FROM support_applications WHERE id = ?", [applicationId], (deleteErr) => {
                if (deleteErr) return res.status(500).json({ error: deleteErr.message });

                if (appRow.status === 'SELECTED') {
                    db.run(
                        "UPDATE support_requests SET status = 'OPEN', selected_application_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [requestId],
                        (updateErr) => {
                            if (updateErr) return res.status(500).json({ error: updateErr.message });
                            res.json({ success: true });
                        }
                    );
                } else {
                    res.json({ success: true });
                }
            });
        }
    );
});

app.post('/api/support-requests/:requestId/select/:applicationId', verifyToken, (req, res) => {
    const requestId = Number(req.params.requestId);
    const applicationId = Number(req.params.applicationId);
    if (!Number.isFinite(requestId) || !Number.isFinite(applicationId)) return res.status(400).json({ error: 'Invalid request.' });

    db.get("SELECT requester_id, status FROM support_requests WHERE id = ?", [requestId], (err, requestRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!requestRow) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        if (requestRow.requester_id !== req.userId && !isAdminRole(req.userRole)) {
            return res.status(403).json({ error: '요청자 또는 운영진만 선택할 수 있습니다.' });
        }

        db.get("SELECT id FROM support_applications WHERE id = ? AND request_id = ?", [applicationId, requestId], (appErr, appRow) => {
            if (appErr) return res.status(500).json({ error: appErr.message });
            if (!appRow) return res.status(404).json({ error: '신청을 찾을 수 없습니다.' });

            db.serialize(() => {
                db.run("UPDATE support_applications SET status = 'APPLIED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?", [requestId]);
                db.run("UPDATE support_applications SET status = 'SELECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [applicationId]);
                db.run(
                    "UPDATE support_requests SET status = 'MATCHED', selected_application_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    [applicationId, requestId],
                    (updateErr) => {
                        if (updateErr) return res.status(500).json({ error: updateErr.message });
                        res.json({ success: true });
                    }
                );
            });
        });
    });
});

// --- BOSS API ---

app.get('/api/schedules', verifyToken, (req, res) => {
    db.all("SELECT * FROM boss_schedules ORDER BY spawnTime ASC", (err, rows) => res.json(rows));
});

app.post('/api/schedules', verifyToken, (req, res) => {
    const schedules = req.body;
    if (!Array.isArray(schedules)) return res.status(400).json({ error: 'Array required.' });
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        schedules.forEach(s => {
            db.run("DELETE FROM boss_schedules WHERE type = ? AND region = ? AND boss = ?", [s.type, s.region, s.boss]);
            db.run("DELETE FROM boss_participants WHERE boss = ?", [s.boss]);
            db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by, is_mung) VALUES (?, ?, ?, ?, ?, 0)", [s.type, s.region, s.boss, s.spawnTime, req.userId]);
        });
        db.run("COMMIT", () => res.json({ success: true }));
    });
});

app.post('/api/schedules/cut', verifyToken, (req, res) => {
    const { type, region, boss } = req.body;
    db.get("SELECT cooldown FROM boss_definitions WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], (err, row) => {
        if (!row || !row.cooldown) return res.status(400).json({ error: 'No cooldown defined for this boss.' });
        const spawnTime = Date.now() + (row.cooldown * 3600 * 1000);
        db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], () => {
            db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);
            db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by, is_mung) VALUES (?, ?, ?, ?, ?, 0)", [type, region, boss, spawnTime, req.userId], () => res.json({ success: true, nextSpawn: spawnTime }));
        });
    });
});

app.post('/api/schedules/mung', verifyToken, (req, res) => {
    const { type, region, boss, currentSpawnTime } = req.body;
    db.get("SELECT cooldown FROM boss_definitions WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], (err, row) => {
        if (!row || !row.cooldown) return res.status(400).json({ error: 'No cooldown defined for this boss.' });
        const nextSpawn = parseInt(currentSpawnTime) + (row.cooldown * 3600 * 1000);
        db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], () => {
            db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);
            db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by, is_mung) VALUES (?, ?, ?, ?, ?, 1)", [type, region, boss, nextSpawn, req.userId], () => res.json({ success: true, nextSpawn: nextSpawn }));
        });
    });
});

app.delete('/api/schedules/:id', verifyToken, (req, res) => {
    db.run("DELETE FROM boss_schedules WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

app.delete('/api/schedules-all', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM boss_schedules", () => res.json({ success: true }));
});

// --- CUSTOM BOSSES API ---
app.get('/api/custom-bosses', (req, res) => {
    db.all("SELECT * FROM boss_definitions ORDER BY sort_order ASC, id ASC", (err, rows) => res.json(rows));
});

app.post('/api/custom-bosses/reorder', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { orderList } = req.body; 
    if (!orderList || !Array.isArray(orderList)) return res.status(400).json({ error: 'Invalid orderList' });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare("UPDATE boss_definitions SET sort_order = ? WHERE boss = ?");
        orderList.forEach(item => {
            stmt.run(item.sort_order, item.boss);
        });
        stmt.finalize();
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

app.post('/api/custom-bosses', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { type, region, boss, cooldown, timeStr, days, color } = req.body;
    if (!boss || !type) return res.status(400).json({ error: 'Required fields missing.' });

    db.run("INSERT INTO boss_definitions (type, region, boss, cooldown, timeStr, days, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [type, region || '공통', boss, cooldown || 0, timeStr || null, days || null, color || null], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        });
});

app.delete('/api/custom-bosses/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    db.get("SELECT boss, type, region FROM boss_definitions WHERE id = ?", [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ error: 'Boss not found.' });
        const { boss: bossName, type, region } = row;
        db.serialize(() => {
            db.run("DELETE FROM boss_definitions WHERE id = ?", [req.params.id]);
            db.run("DELETE FROM boss_schedules WHERE boss = ? AND type = ? AND region = ?", [bossName, type, region]);
            res.json({ success: true });
        });
    });
});

app.post('/api/admin/reset-bosses', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.serialize(() => {
        db.run("DELETE FROM boss_definitions");
        db.run("DELETE FROM boss_schedules", () => {
            seedDefaultBosses();
            res.json({ success: true });
        });
    });
});

// --- PARTICIPANTS ---
app.post('/api/participants/:boss', verifyToken, (req, res) => {
    const boss = req.params.boss;
    db.get("SELECT nickname FROM users WHERE id = ?", [req.userId], (err, row) => {
        const userNick = row.nickname;
        db.get("SELECT * FROM boss_participants WHERE boss = ? AND nickname = ?", [boss, userNick], (err, existing) => {
            if (existing) {
                db.run("DELETE FROM boss_participants WHERE boss = ? AND nickname = ?", [boss, userNick], () => res.json({ joined: false }));
            } else {
                db.run("INSERT INTO boss_participants (boss, nickname) VALUES (?, ?)", [boss, userNick], () => res.json({ joined: true }));
            }
        });
    });
});

app.get('/api/participants', verifyToken, (req, res) => {
    db.all("SELECT boss, nickname FROM boss_participants", (err, rows) => {
        const map = {};
        rows.forEach(r => {
            if (!map[r.boss]) map[r.boss] = [];
            map[r.boss].push(r.nickname);
        });
        res.json(map);
    });
});

app.get('/api/participation-targets', verifyToken, (req, res) => {
    db.all("SELECT boss FROM participation_targets", (err, rows) => res.json(rows.map(r => r.boss)));
});

app.post('/api/participation-targets', verifyToken, (req, res) => {
    const { bosses } = req.body;
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.serialize(() => {
        db.run("DELETE FROM participation_targets");
        const stmt = db.prepare("INSERT INTO participation_targets (boss) VALUES (?)");
        bosses.forEach(b => stmt.run(b));
        stmt.finalize();
        res.json({ success: true });
    });
});

const getVoteKey = (item) => item.isManual ? `manual|${item.id}` : `${item.type}|${item.region}|${item.boss}|${item.spawnTime}`;

const getTodayTomorrowWindow = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);
    end.setMilliseconds(-1);
    return { startMs: start.getTime(), endMs: end.getTime() };
};

const getYesterdayTomorrowWindow = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 3);
    end.setMilliseconds(-1);
    return { startMs: start.getTime(), endMs: end.getTime() };
};

const injectFixedVoteEvents = (rows, targets, startMs, endMs) => {
    const daysArr = ['일', '월', '화', '수', '목', '금', '토'];
    const existing = new Set(rows.map(r => getVoteKey(r)));
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const totalDays = Math.max(0, Math.ceil((new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() - new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime()) / 86400000));

    for (let i = 0; i <= totalDays; i++) {
        const targetDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
        targetDate.setDate(targetDate.getDate() + i);
        const dayLabel = daysArr[targetDate.getDay()];

        targets
            .filter(t => t.timeStr && t.days && (!t.days || t.days.includes(dayLabel)))
            .forEach(t => {
                const [h, m, s] = String(t.timeStr).split(':').map(Number);
                const spawnDate = new Date(targetDate);
                spawnDate.setHours(h || 0, m || 0, s || 0, 0);
                const spawnTime = spawnDate.getTime();
                if (spawnTime < startMs || spawnTime > endMs) return;

                const item = {
                    id: null,
                    type: t.type,
                    region: t.region || '공통',
                    boss: t.boss,
                    spawnTime,
                    isFixed: true
                };
                const key = getVoteKey(item);
                if (!existing.has(key)) {
                    rows.push(item);
                    existing.add(key);
                }
            });
    }
};

const applyInactiveVoteStates = (rows, startMs, endMs, callback) => {
    db.all(
        `SELECT vote_key, state
         FROM boss_vote_event_states
         WHERE spawnTime >= ? AND spawnTime <= ?`,
        [startMs, endMs],
        (stateErr, stateRows) => {
            if (stateErr) return callback(stateErr);
            const inactiveKeys = new Set(
                (stateRows || [])
                    .filter(row => String(row.state || 'ACTIVE').toUpperCase() === 'INACTIVE')
                    .map(row => row.vote_key)
            );
            callback(null, rows.filter(row => !inactiveKeys.has(getVoteKey(row))));
        }
    );
};

const buildVoteRowsForRange = (startMs, endMs, callback) => {
    db.all("SELECT boss FROM participation_targets", (targetErr, targetRows) => {
        if (targetErr) return callback(targetErr);
        const targetBosses = (targetRows || []).map(r => r.boss);
        const voteRows = [];

        const loadManualRows = () => {
            db.all(
                `SELECT id, type, region, boss, spawnTime, is_blessed
                 FROM boss_vote_events
                 WHERE spawnTime >= ? AND spawnTime <= ?`,
                [startMs, endMs],
                (manualErr, manualRows) => {
                    if (manualErr) return callback(manualErr);
                    (manualRows || []).forEach(r => {
                        voteRows.push({
                            ...r,
                            isFixed: false,
                            isManual: true,
                            isBlessed: !!r.is_blessed
                        });
                    });

                    applyInactiveVoteStates(voteRows, startMs, endMs, (stateErr, filteredRows) => {
                        if (stateErr) return callback(stateErr);
                        filteredRows.sort((a, b) => a.spawnTime - b.spawnTime);
                        callback(null, filteredRows);
                    });
                }
            );
        };

        const loadFixedRows = () => {
            if (targetBosses.length === 0) return loadManualRows();
            const placeholders = targetBosses.map(() => '?').join(',');
            db.all(
                `SELECT type, region, boss, timeStr, days
                 FROM boss_definitions
                 WHERE timeStr IS NOT NULL AND boss IN (${placeholders})`,
                targetBosses,
                (fixedErr, fixedRows) => {
                    if (fixedErr) return callback(fixedErr);
                    injectFixedVoteEvents(voteRows, fixedRows || [], startMs, endMs);
                    loadManualRows();
                }
            );
        };

        if (targetBosses.length === 0) return loadManualRows();

        const placeholders = targetBosses.map(() => '?').join(',');
        db.all(
            `SELECT id, type, region, boss, spawnTime, is_mung
             FROM boss_schedules
             WHERE spawnTime >= ? AND spawnTime <= ? AND boss IN (${placeholders})`,
            [startMs, endMs, ...targetBosses],
            (scheduleErr, scheduleRows) => {
                if (scheduleErr) return callback(scheduleErr);
                (scheduleRows || []).forEach(r => {
                    voteRows.push({
                        ...r,
                        isFixed: false,
                        isManual: false
                    });
                });
                loadFixedRows();
            }
        );
    });
};

app.get('/api/vote-bosses', verifyToken, (req, res) => {
    const { startMs, endMs } = getYesterdayTomorrowWindow();
    buildVoteRowsForRange(startMs, endMs, (voteErr, voteRows) => {
        if (voteErr) return res.status(500).json({ error: voteErr.message });
        const voteKeys = voteRows.map(r => getVoteKey(r));
        if (voteKeys.length === 0) return res.json([]);

        const participantSql = `
            SELECT vote_key, user_id, nickname
            FROM boss_vote_participants
            WHERE vote_key IN (${voteKeys.map(() => '?').join(',')})
            ORDER BY created_at ASC
        `;

        db.all(participantSql, voteKeys, (participantErr, participantRows) => {
            if (participantErr) return res.status(500).json({ error: participantErr.message });

            const participantMap = {};
            (participantRows || []).forEach(p => {
                if (!participantMap[p.vote_key]) participantMap[p.vote_key] = [];
                participantMap[p.vote_key].push({ userId: p.user_id, nickname: p.nickname });
            });

            res.json(voteRows.map(row => {
                const voteKey = getVoteKey(row);
                const participants = participantMap[voteKey] || [];
                return {
                    ...row,
                    voteKey,
                    participants,
                    participantCount: participants.length,
                    joined: participants.some(p => p.userId === req.userId)
                };
            }));
        });
    });
});

app.post('/api/vote-bosses/manual', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const { boss, spawnTime, type, region, isBlessed } = req.body || {};
    const parsedSpawnTime = Number(spawnTime);
    if (!boss || !Number.isFinite(parsedSpawnTime)) return res.status(400).json({ error: 'boss and spawnTime are required.' });

    const { startMs, endMs } = getTodayTomorrowWindow();
    if (parsedSpawnTime < startMs || parsedSpawnTime > endMs) {
        return res.status(400).json({ error: 'Only today or tomorrow vote bosses can be added.' });
    }

    db.run(
        "INSERT INTO boss_vote_events (type, region, boss, spawnTime, is_blessed, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [type || '본섭', region || '', boss.trim(), parsedSpawnTime, isBlessed ? 1 : 0, req.userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.delete('/api/vote-bosses/manual/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const voteKey = `manual|${req.params.id}`;
    db.serialize(() => {
        db.run("DELETE FROM boss_vote_participants WHERE vote_key = ?", [voteKey]);
        db.run("DELETE FROM boss_vote_events WHERE id = ?", [req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Vote boss not found.' });
            res.json({ success: true });
        });
    });
});

app.delete('/api/vote-bosses/:voteKey', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const voteKey = String(req.params.voteKey || '');
    const { boss, spawnTime } = req.body || {};
    const parsedSpawnTime = Number(spawnTime);
    if (!voteKey || !boss || !Number.isFinite(parsedSpawnTime)) {
        return res.status(400).json({ error: 'voteKey, boss, and spawnTime are required.' });
    }

    db.run(
        `INSERT INTO boss_vote_event_states (vote_key, boss, spawnTime, state, updated_by, updated_at)
         VALUES (?, ?, ?, 'INACTIVE', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(vote_key) DO UPDATE SET
           boss = excluded.boss,
           spawnTime = excluded.spawnTime,
           state = 'INACTIVE',
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [voteKey, String(boss).trim(), parsedSpawnTime, req.userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, state: 'INACTIVE' });
        }
    );
});

app.get('/api/vote-stats', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM.' });

    const [year, monthNum] = month.split('-').map(Number);
    const start = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, monthNum, 1, 0, 0, 0, 0);
    const startMs = start.getTime();
    const endMs = end.getTime() - 1;

    buildVoteRowsForRange(startMs, endMs, (voteErr, voteRows) => {
        if (voteErr) return res.status(500).json({ error: voteErr.message });

        const bossMap = new Map();
        voteRows.forEach(row => {
            const voteKey = getVoteKey(row);
            const date = new Date(row.spawnTime);
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            bossMap.set(voteKey, {
                voteKey,
                dateKey,
                boss: row.boss,
                spawnTime: row.spawnTime,
                type: row.type || '',
                region: row.region || '',
                isManual: !!row.isManual,
                isBlessed: !!row.isBlessed,
                participants: []
            });
        });

        if (bossMap.size === 0) {
            return res.json({ month, totalBosses: 0, totalParticipants: 0, days: [] });
        }

        db.all(
            `SELECT vote_key, boss, spawnTime, user_id, nickname, created_at
             FROM boss_vote_participants
             WHERE spawnTime >= ? AND spawnTime <= ?
             ORDER BY spawnTime ASC, created_at ASC`,
            [startMs, endMs],
            (participantErr, participantRows) => {
                if (participantErr) return res.status(500).json({ error: participantErr.message });

                (participantRows || []).forEach(row => {
                    const entry = bossMap.get(row.vote_key);
                    if (!entry) return;
                    entry.participants.push({
                        userId: row.user_id,
                        nickname: row.nickname,
                        joinedAt: row.created_at
                    });
                });

                const daysMap = new Map();
                Array.from(bossMap.values())
                    .sort((a, b) => a.spawnTime - b.spawnTime)
                    .forEach(entry => {
                        if (!daysMap.has(entry.dateKey)) {
                            daysMap.set(entry.dateKey, {
                                date: entry.dateKey,
                                bosses: [],
                                totalParticipants: 0
                            });
                        }

                        const day = daysMap.get(entry.dateKey);
                        const bossEntry = {
                            ...entry,
                            participantCount: entry.participants.length
                        };
                        day.bosses.push(bossEntry);
                        day.totalParticipants += bossEntry.participantCount;
                    });

                const days = Array.from(daysMap.values());
                res.json({
                    month,
                    totalBosses: bossMap.size,
                    totalParticipants: days.reduce((sum, day) => sum + day.totalParticipants, 0),
                    days
                });
            }
        );
    });
});

app.get('/api/vote-member-rates', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const startText = String(req.query.start || '');
    const endText = String(req.query.end || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startText) || !/^\d{4}-\d{2}-\d{2}$/.test(endText)) {
        return res.status(400).json({ error: 'start and end must be YYYY-MM-DD.' });
    }

    const [startYear, startMonth, startDay] = startText.split('-').map(Number);
    const [endYear, endMonth, endDay] = endText.split('-').map(Number);
    const startMs = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0).getTime();
    const endMs = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        return res.status(400).json({ error: 'Invalid date range.' });
    }

    buildVoteRowsForRange(startMs, endMs, (voteErr, voteRows) => {
        if (voteErr) return res.status(500).json({ error: voteErr.message });

        const voteKeySet = new Set(voteRows.map(row => getVoteKey(row)));

        db.all(
            `SELECT vote_key, user_id
             FROM boss_vote_participants
             WHERE spawnTime >= ? AND spawnTime <= ?`,
            [startMs, endMs],
            (participantErr, participantRows) => {
                if (participantErr) return res.status(500).json({ error: participantErr.message });

                const participationByUser = new Map();
                (participantRows || [])
                    .filter(row => voteKeySet.has(row.vote_key))
                    .forEach(row => {
                        if (!participationByUser.has(row.user_id)) participationByUser.set(row.user_id, new Set());
                        participationByUser.get(row.user_id).add(row.vote_key);
                    });

                db.all(
                    "SELECT id, role, username, nickname FROM users ORDER BY COALESCE(nickname, username) ASC",
                    (userErr, users) => {
                        if (userErr) return res.status(500).json({ error: userErr.message });

                        const totalBosses = voteRows.length;
                        const members = (users || []).map(user => {
                            const joinedCount = participationByUser.get(user.id)?.size || 0;
                            const rate = totalBosses > 0 ? Math.round((joinedCount / totalBosses) * 1000) / 10 : 0;
                            return {
                                userId: user.id,
                                nickname: user.nickname || user.username,
                                role: user.role,
                                joinedCount,
                                totalBosses,
                                missedCount: Math.max(totalBosses - joinedCount, 0),
                                rate
                            };
                        });

                        res.json({
                            start: startText,
                            end: endText,
                            totalBosses,
                            memberCount: members.length,
                            members
                        });
                    }
                );
            }
        );
    });
});

app.delete('/api/vote-participants/:voteKey/users/:userId', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });

    const voteKey = req.params.voteKey;
    const userId = Number(req.params.userId);
    if (!voteKey || !Number.isFinite(userId)) return res.status(400).json({ error: 'voteKey and userId are required.' });

    db.run("DELETE FROM boss_vote_participants WHERE vote_key = ? AND user_id = ?", [voteKey, userId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Participant not found.' });
        res.json({ success: true });
    });
});

app.post('/api/vote-participants/:voteKey', verifyToken, (req, res) => {
    const voteKey = req.params.voteKey;
    const { boss, spawnTime } = req.body || {};
    if (!boss || !spawnTime) return res.status(400).json({ error: 'boss and spawnTime are required.' });

    db.get(
        "SELECT state FROM boss_vote_event_states WHERE vote_key = ?",
        [voteKey],
        (stateErr, stateRow) => {
            if (stateErr) return res.status(500).json({ error: stateErr.message });
            if (stateRow && String(stateRow.state || '').toUpperCase() === 'INACTIVE') {
                return res.status(400).json({ error: 'Inactive vote boss.' });
            }

    db.get("SELECT nickname FROM users WHERE id = ?", [req.userId], (userErr, user) => {
        if (userErr) return res.status(500).json({ error: userErr.message });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        db.get("SELECT vote_key FROM boss_vote_participants WHERE vote_key = ? AND user_id = ?", [voteKey, req.userId], (findErr, existing) => {
            if (findErr) return res.status(500).json({ error: findErr.message });

            if (existing) {
                db.run("DELETE FROM boss_vote_participants WHERE vote_key = ? AND user_id = ?", [voteKey, req.userId], (deleteErr) => {
                    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
                    res.json({ joined: false });
                });
            } else {
                db.run(
                    "INSERT INTO boss_vote_participants (vote_key, boss, spawnTime, user_id, nickname) VALUES (?, ?, ?, ?, ?)",
                    [voteKey, boss, spawnTime, req.userId, user.nickname || req.userName],
                    (insertErr) => {
                        if (insertErr) return res.status(500).json({ error: insertErr.message });
                        res.json({ joined: true });
                    }
                );
            }
        });
    });
        }
    );
});

// --- COLLECTIONS ---
app.get('/api/excluded-members', verifyToken, (req, res) => {
    db.all("SELECT user_id FROM excluded_members", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.user_id));
    });
});

app.post('/api/excluded-members/toggle', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { userId } = req.body;
    db.get("SELECT * FROM excluded_members WHERE user_id = ?", [userId], (err, row) => {
        if (row) {
            db.run("DELETE FROM excluded_members WHERE user_id = ?", [userId], () => res.json({ status: 'removed' }));
        } else {
            db.run("INSERT INTO excluded_members (user_id) VALUES (?)", [userId], () => res.json({ status: 'added' }));
        }
    });
});

const normalizeCollectionItems = (items) => {
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
        if (typeof item === 'string') {
            const [part = '', enchantment = ''] = item.split('|').map(value => value.trim());
            return { id: null, part, enchantment };
        }

        const id = Number.parseInt(item && item.id, 10);
        return {
            id: Number.isInteger(id) && id > 0 ? id : null,
            part: String((item && item.part) || '').trim(),
            enchantment: String((item && item.enchantment) || '').trim()
        };
    }).filter(item => item.part && item.enchantment);
};

const serializeLegacyItems = (items) => JSON.stringify(
    items.map(item => `${item.part} | ${item.enchantment}`)
);

const assignLegacyKeys = (collectionName, items) => {
    const seenCounts = {};
    return items.map((item) => {
        const countKey = `${item.part} | ${item.enchantment}`;
        seenCounts[countKey] = (seenCounts[countKey] || 0) + 1;
        let legacyKey = `${collectionName}||${item.part}||${item.enchantment}`;
        if (seenCounts[countKey] > 1) legacyKey += `||${seenCounts[countKey]}`;
        return { ...item, legacyKey };
    });
};

let collectionMutationQueue = Promise.resolve();
const queueCollectionMutation = (mutation) => {
    const result = collectionMutationQueue.then(mutation, mutation);
    collectionMutationQueue = result.catch(() => {});
    return result;
};

const updateCollectionWithItems = (collectionId, name, rawItems) => {
    const items = assignLegacyKeys(name, rawItems);
    return queueCollectionMutation(async () => {
        await dbRun("BEGIN IMMEDIATE TRANSACTION");
        try {
            const collectionResult = await dbRun(
                "UPDATE collections SET name = ?, items = ? WHERE id = ?",
                [name, serializeLegacyItems(items), collectionId]
            );
            if (collectionResult.changes === 0) throw new Error('Collection not found.');

            const existingItems = await dbAll(
                "SELECT id, legacy_key FROM collection_items WHERE collection_id = ?",
                [collectionId]
            );
            const existingById = new Map(existingItems.map(item => [item.id, item]));
            await dbRun("UPDATE collection_items SET is_active = 0 WHERE collection_id = ?", [collectionId]);

            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                if (item.id) {
                    const existing = existingById.get(item.id);
                    if (!existing) {
                        throw new Error(`Collection item ${item.id} does not belong to this collection.`);
                    }
                    await dbRun(
                        `UPDATE collection_items
                         SET part = ?, enchantment = ?, sort_order = ?, legacy_key = ?, is_active = 1
                         WHERE id = ? AND collection_id = ?`,
                        [item.part, item.enchantment, index, item.legacyKey, item.id, collectionId]
                    );
                    if (existing.legacy_key && existing.legacy_key !== item.legacyKey) {
                        await dbRun(
                            `INSERT OR IGNORE INTO user_collections (user_id, collection_name)
                             SELECT user_id, ? FROM user_collections WHERE collection_name = ?`,
                            [item.legacyKey, existing.legacy_key]
                        );
                        await dbRun(
                            "DELETE FROM user_collections WHERE collection_name = ?",
                            [existing.legacy_key]
                        );
                    }
                } else {
                    await dbRun(
                        `INSERT INTO collection_items
                            (collection_id, part, enchantment, sort_order, legacy_key, is_active)
                         VALUES (?, ?, ?, ?, ?, 1)`,
                        [collectionId, item.part, item.enchantment, index, item.legacyKey]
                    );
                }
            }

            await dbRun("COMMIT");
        } catch (err) {
            try { await dbRun("ROLLBACK"); } catch (_) {}
            throw err;
        }
    });
};

const syncLegacyCheckToV2 = (userId, legacyKey, completed, callback) => {
    db.all(
        "SELECT id FROM collection_items WHERE legacy_key = ? AND is_active = 1",
        [legacyKey],
        (lookupErr, items) => {
            if (lookupErr || items.length === 0) return callback();
            let remaining = items.length;
            const finish = () => {
                remaining -= 1;
                if (remaining === 0) callback();
            };
            items.forEach((item) => {
                const sql = completed
                    ? "INSERT OR IGNORE INTO user_collection_items (user_id, collection_item_id) VALUES (?, ?)"
                    : "DELETE FROM user_collection_items WHERE user_id = ? AND collection_item_id = ?";
                db.run(sql, [userId, item.id], finish);
            });
        }
    );
};

const syncV2CheckToLegacy = (userId, collectionItemId, completed, callback) => {
    db.get(
        "SELECT legacy_key FROM collection_items WHERE id = ?",
        [collectionItemId],
        (lookupErr, item) => {
            if (lookupErr || !item || !item.legacy_key) return callback();
            const sql = completed
                ? "INSERT OR IGNORE INTO user_collections (user_id, collection_name) VALUES (?, ?)"
                : "DELETE FROM user_collections WHERE user_id = ? AND collection_name = ?";
            db.run(sql, [userId, item.legacy_key], () => callback());
        }
    );
};

// V1 is retained for migration verification and is accessible only to the master.
app.get('/api/user-collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    db.all("SELECT user_id, collection_name FROM user_collections", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/user-collections/toggle', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    const { userId, collectionName, completed } = req.body;
    const targetUserId = parseInt(userId, 10);
    if (!targetUserId || !collectionName || typeof completed !== 'boolean') {
        return res.status(400).json({ error: 'Invalid request.' });
    }
    const sql = completed
        ? "INSERT OR IGNORE INTO user_collections (user_id, collection_name) VALUES (?, ?)"
        : "DELETE FROM user_collections WHERE user_id = ? AND collection_name = ?";
    db.run(sql, [targetUserId, collectionName], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        syncLegacyCheckToV2(targetUserId, collectionName, completed, () => {
            res.json({ status: completed ? 'added' : 'removed' });
        });
    });
});

app.get('/api/collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    db.all("SELECT * FROM collections ORDER BY id ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        try {
            res.json(rows.map(row => ({ ...row, items: JSON.parse(row.items) })));
        } catch (parseErr) {
            res.status(500).json({ error: parseErr.message });
        }
    });
});

app.get('/api/v2/user-collections', verifyToken, (req, res) => {
    db.all(
        `SELECT uci.user_id, uci.collection_item_id
         FROM user_collection_items uci
         JOIN collection_items ci ON ci.id = uci.collection_item_id
         WHERE ci.is_active = 1`,
        (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
        }
    );
});

app.post('/api/v2/user-collections/toggle', verifyToken, (req, res) => {
    const { userId, collectionItemId, completed } = req.body;
    const targetUserId = parseInt(userId, 10);
    const targetCollectionItemId = parseInt(collectionItemId, 10);
    if (!targetUserId || !targetCollectionItemId || typeof completed !== 'boolean') {
        return res.status(400).json({ error: 'Invalid request.' });
    }
    if (req.userId !== targetUserId && req.userRole !== 'MASTER') {
        return res.status(403).json({ error: 'Master only for editing other members.' });
    }

    db.get(
        "SELECT id FROM collection_items WHERE id = ? AND is_active = 1",
        [targetCollectionItemId],
        (itemErr, item) => {
            if (itemErr) return res.status(500).json({ error: itemErr.message });
            if (!item) return res.status(404).json({ error: 'Collection item not found.' });

        if (completed) {
            return db.run(
                    "INSERT OR IGNORE INTO user_collection_items (user_id, collection_item_id) VALUES (?, ?)",
                    [targetUserId, targetCollectionItemId],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    syncV2CheckToLegacy(targetUserId, targetCollectionItemId, true, () => {
                        res.json({ status: 'added' });
                    });
                }
            );
        }

        return db.run(
                "DELETE FROM user_collection_items WHERE user_id = ? AND collection_item_id = ?",
                [targetUserId, targetCollectionItemId],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                syncV2CheckToLegacy(targetUserId, targetCollectionItemId, false, () => {
                    res.json({ status: 'removed' });
                });
            }
        );
        }
    );
});

app.get('/api/v2/collections', verifyToken, (req, res) => {
    db.all(
        `SELECT
            c.id,
            c.name,
            c.created_at,
            ci.id AS item_id,
            ci.part,
            ci.enchantment,
            ci.sort_order
         FROM collections c
         LEFT JOIN collection_items ci
           ON ci.collection_id = c.id AND ci.is_active = 1
         ORDER BY c.id ASC, ci.sort_order ASC, ci.id ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const collectionsById = new Map();
            rows.forEach((row) => {
                if (!collectionsById.has(row.id)) {
                    collectionsById.set(row.id, {
                        id: row.id,
                        name: row.name,
                        created_at: row.created_at,
                        items: []
                    });
                }
                if (row.item_id) {
                    collectionsById.get(row.id).items.push({
                        id: row.item_id,
                        part: row.part,
                        enchantment: row.enchantment
                    });
                }
            });
            res.json(Array.from(collectionsById.values()));
        }
    );
});

app.post('/api/v2/collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const name = String(req.body.name || '').trim();
    const normalizedItems = normalizeCollectionItems(req.body.items);
    if (!name || normalizedItems.length === 0) return res.status(400).json({ error: 'Name and items are required.' });
    const items = assignLegacyKeys(name, normalizedItems);

    queueCollectionMutation(async () => {
        await dbRun("BEGIN IMMEDIATE TRANSACTION");
        try {
            const collectionResult = await dbRun(
                "INSERT INTO collections (name, items) VALUES (?, ?)",
                [name, serializeLegacyItems(items)]
            );
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                await dbRun(
                    `INSERT INTO collection_items
                        (collection_id, part, enchantment, sort_order, legacy_key, is_active)
                     VALUES (?, ?, ?, ?, ?, 1)`,
                    [collectionResult.lastID, item.part, item.enchantment, index, item.legacyKey]
                );
            }
            await dbRun("COMMIT");
            return collectionResult.lastID;
        } catch (err) {
            try { await dbRun("ROLLBACK"); } catch (_) {}
            throw err;
        }
    }).then(
        id => res.json({ success: true, id }),
        err => res.status(500).json({ error: err.message })
    );
});

app.delete('/api/v2/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const collectionId = parseInt(req.params.id, 10);
    if (!collectionId) return res.status(400).json({ error: 'Invalid collection id.' });

    queueCollectionMutation(async () => {
        await dbRun("BEGIN IMMEDIATE TRANSACTION");
        try {
            await dbRun(
                `DELETE FROM user_collections
                 WHERE collection_name IN (
                    SELECT legacy_key
                    FROM collection_items
                    WHERE collection_id = ? AND legacy_key IS NOT NULL
                 )`,
                [collectionId]
            );
            await dbRun(
                `DELETE FROM user_collection_items
                 WHERE collection_item_id IN (
                    SELECT id FROM collection_items WHERE collection_id = ?
                 )`,
                [collectionId]
            );
            await dbRun("DELETE FROM collection_items WHERE collection_id = ?", [collectionId]);
            const result = await dbRun("DELETE FROM collections WHERE id = ?", [collectionId]);
            if (result.changes === 0) throw new Error('Collection not found.');
            await dbRun("COMMIT");
        } catch (err) {
            try { await dbRun("ROLLBACK"); } catch (_) {}
            throw err;
        }
    }).then(
        () => res.json({ success: true }),
        err => res.status(500).json({ error: err.message })
    );
});

app.put('/api/v2/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const collectionId = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    const items = normalizeCollectionItems(req.body.items);
    if (!collectionId || !name || items.length === 0) {
        return res.status(400).json({ error: 'Collection id, name, and items are required.' });
    }

    const suppliedIds = items.filter(item => item.id).map(item => item.id);
    if (new Set(suppliedIds).size !== suppliedIds.length) {
        return res.status(400).json({ error: 'Duplicate collection item id.' });
    }

    updateCollectionWithItems(collectionId, name, items).then(
        () => res.json({ success: true }),
        err => res.status(500).json({ error: err.message })
    );
});

app.post('/api/collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    res.redirect(307, '/api/v2/collections');
});

app.delete('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    res.redirect(307, `/api/v2/collections/${req.params.id}`);
});

app.put('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });

    const collectionId = parseInt(req.params.id, 10);
    const name = String(req.body.name || '').trim();
    const incomingItems = normalizeCollectionItems(req.body.items);
    if (!collectionId || !name || incomingItems.length === 0) {
        return res.status(400).json({ error: 'Collection id, name, and items are required.' });
    }

    db.all(
        `SELECT id, part, enchantment
         FROM collection_items
         WHERE collection_id = ? AND is_active = 1
         ORDER BY sort_order ASC, id ASC`,
        [collectionId],
        (err, existingItems) => {
            if (err) return res.status(500).json({ error: err.message });

            const unusedIds = new Set(existingItems.map(item => item.id));
            const itemsWithIds = incomingItems.map((item, index) => {
                let match = existingItems.find(existing =>
                    unusedIds.has(existing.id)
                    && existing.part === item.part
                    && existing.enchantment === item.enchantment
                );
                if (!match && existingItems[index] && unusedIds.has(existingItems[index].id)) {
                    match = existingItems[index];
                }
                if (!match) match = existingItems.find(existing => unusedIds.has(existing.id));
                if (match) unusedIds.delete(match.id);
                return { ...item, id: match ? match.id : null };
            });

            updateCollectionWithItems(collectionId, name, itemsWithIds).then(
                () => res.json({ success: true }),
                updateErr => res.status(500).json({ error: updateErr.message })
            );
        }
    );
});

// --- ADMIN USERS ---
app.put('/api/admin/users/:id/role', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    db.get("SELECT role FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (user.role === 'MASTER') return res.status(403).json({ error: 'Master role protected.' });
        db.run("UPDATE users SET role = ? WHERE id = ?", [req.body.role, req.params.id], () => res.json({ success: true }));
    });
});

app.delete('/api/admin/users/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only.' });
    const targetUserId = parseInt(req.params.id, 10);
    if (!targetUserId) return res.status(400).json({ error: 'Invalid user id.' });

    db.get("SELECT role, nickname FROM users WHERE id = ?", [targetUserId], (err, user) => {
        if (err) return res.status(500).json({ error: 'DB Error.' });
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.role === 'MASTER') return res.status(403).json({ error: 'Master role protected.' });

        const runSql = (sql, params = []) => new Promise((resolve, reject) => {
            db.run(sql, params, function (runErr) {
                if (runErr) reject(runErr);
                else resolve(this);
            });
        });

        (async () => {
            try {
                await runSql("BEGIN TRANSACTION");
                await runSql("DELETE FROM user_collections WHERE user_id = ?", [targetUserId]);
                await runSql("DELETE FROM user_collection_items WHERE user_id = ?", [targetUserId]);
                await runSql("DELETE FROM user_alternate_characters WHERE user_id = ?", [targetUserId]);
                await runSql("DELETE FROM group_members WHERE user_id = ?", [targetUserId]);
                await runSql("DELETE FROM excluded_members WHERE user_id = ?", [targetUserId]);
                await runSql("DELETE FROM siege_data WHERE user_id = ?", [targetUserId]);
                if (user.nickname) {
                    await runSql("DELETE FROM boss_participants WHERE nickname = ?", [user.nickname]);
                }
                await runSql("DELETE FROM users WHERE id = ?", [targetUserId]);
                await runSql("COMMIT");
                res.json({ success: true });
            } catch (txErr) {
                try { await runSql("ROLLBACK"); } catch (_) { }
                res.status(500).json({ error: 'Delete transaction failed.' });
            }
        })();
    });
});

app.put('/api/admin/users/:id/reset-password', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.get("SELECT role FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'User not found.' });
        if (user.role === 'MASTER' && req.userRole !== 'MASTER') return res.status(403).json({ error: 'Only Master can reset Master password.' });

        const hash = bcrypt.hashSync('1234', 10);
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.params.id], (err) => {
            if (err) return res.status(500).json({ error: 'DB Error.' });
            res.json({ success: true });
        });
    });
});

// --- CONTENT GROUPS API ---
app.get('/api/groups', verifyToken, (req, res) => {
    db.all(`
        SELECT g.id, g.name, IFNULL(GROUP_CONCAT(gm.user_id), '') as memberIds
        FROM content_groups g
        LEFT JOIN group_members gm ON g.id = gm.group_id
        GROUP BY g.id
    `, (err, rows) => {
        if (err) {
            console.error('❌ GET /api/groups Error:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows.map(r => ({
            id: r.id,
            name: r.name,
            memberIds: r.memberIds ? r.memberIds.split(',').map(Number) : []
        })));
    });
});

app.post('/api/groups', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { name } = req.body;
    db.run("INSERT INTO content_groups (name) VALUES (?)", [name || '새 그룹'], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name: name || '새 그룹' });
    });
});

app.put('/api/groups/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { name } = req.body;
    db.run("UPDATE content_groups SET name = ? WHERE id = ?", [name, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});
app.delete('/api/groups/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const groupId = req.params.id;
    db.serialize(() => {
        db.run("DELETE FROM group_members WHERE group_id = ?", [groupId]);
        db.run("DELETE FROM content_groups WHERE id = ?", [groupId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

app.post('/api/groups/:id/members', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const groupId = req.params.id;
    const { userIds } = req.body; // Array of user IDs
    db.serialize(() => {
        db.run("DELETE FROM group_members WHERE group_id = ?", [groupId]);
        if (userIds && userIds.length > 0) {
            const stmt = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)");
            userIds.forEach(uid => stmt.run(groupId, uid));
            stmt.finalize();
        }
        res.json({ success: true });
    });
});

// --- SIEGE PARTICIPATION API ---
app.get('/api/siege', verifyToken, (req, res) => {
    const query = `
        SELECT u.id, u.nickname, u.main_class, u.combat_power,
               IFNULL(s.current_diamonds, 0) as current_diamonds,
               IFNULL(s.remaining_diamonds, 0) as remaining_diamonds,
               s.updated_at
        FROM users u
        LEFT JOIN siege_data s ON u.id = s.user_id
        ORDER BY u.combat_power DESC
    `;
    db.all(query, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/siege/me', verifyToken, (req, res) => {
    const { current_diamonds, remaining_diamonds } = req.body;
    const userId = req.userId;
    const now = new Date().toISOString();

    db.get("SELECT user_id FROM siege_data WHERE user_id = ?", [userId], (err, row) => {
        if (row) {
            db.run("UPDATE siege_data SET current_diamonds = ?, remaining_diamonds = ?, updated_at = ? WHERE user_id = ?",
                [current_diamonds, remaining_diamonds, now, userId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        } else {
            db.run("INSERT INTO siege_data (user_id, current_diamonds, remaining_diamonds, updated_at) VALUES (?, ?, ?, ?)",
                [userId, current_diamonds, remaining_diamonds, now], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        }
    });
});

app.delete('/api/siege/all', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') {
        console.warn(`⚠️ Unauthorized Siege Reset Attempt by ${req.userNickname || req.userName}`);
        return res.status(403).json({ error: 'Unauthorized.' });
    }
    console.log(`🧹 Siege data reset initiated by ${req.userNickname || req.userName}`);
    db.run("DELETE FROM siege_data", (err) => {
        if (err) {
            console.error('❌ Siege Reset Error:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
    });
});

app.put('/api/admin/siege/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const targetUserId = req.params.id;
    const { current_diamonds, remaining_diamonds } = req.body;
    const now = new Date().toISOString();

    db.get("SELECT user_id FROM siege_data WHERE user_id = ?", [targetUserId], (err, row) => {
        if (row) {
            db.run("UPDATE siege_data SET current_diamonds = ?, remaining_diamonds = ?, updated_at = ? WHERE user_id = ?",
                [current_diamonds, remaining_diamonds, now, targetUserId], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        } else {
            db.run("INSERT INTO siege_data (user_id, current_diamonds, remaining_diamonds, updated_at) VALUES (?, ?, ?, ?)",
                [targetUserId, current_diamonds, remaining_diamonds, now], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                });
        }
    });
});

// --- NOTICE (Guild Rules / Price List) ---
app.get('/api/notices/rules', verifyToken, (req, res) => {
    db.all("SELECT id, title, content, color, sort_order, created_by, created_at, updated_at FROM guild_rules ORDER BY sort_order ASC, id ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/notices/rules', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { title, content, color } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });
    db.get("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM guild_rules", (orderErr, row) => {
        if (orderErr) return res.status(500).json({ error: orderErr.message });
        db.run(
            "INSERT INTO guild_rules (title, content, color, sort_order, created_by, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [String(title).trim(), String(content || '').trim(), String(color || '#f8fafc').trim(), row.next_order || 0, req.userId],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: this.lastID });
            }
        );
    });
});

app.put('/api/notices/rule-order', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(id => parseInt(id, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids are required.' });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("UPDATE guild_rules SET sort_order = ? WHERE id = ?");
        ids.forEach((id, index) => stmt.run(index, id));
        stmt.finalize((stmtErr) => {
            if (stmtErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: stmtErr.message });
            }
            db.run("COMMIT", (commitErr) => {
                if (commitErr) return res.status(500).json({ error: commitErr.message });
                res.json({ success: true });
            });
        });
    });
});

app.put('/api/notices/rules/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { title, content, color } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });
    db.run(
        "UPDATE guild_rules SET title = ?, content = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [String(title).trim(), String(content || '').trim(), String(color || '#f8fafc').trim(), req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Rule not found.' });
            res.json({ success: true });
        }
    );
});

app.delete('/api/notices/rules/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM guild_rules WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Rule not found.' });
        res.json({ success: true });
    });
});

// New price guide APIs (same behavior pattern as guild rules)
app.get('/api/notices/price-guides', verifyToken, (req, res) => {
    db.all("SELECT id, title, content, color, created_by, created_at, updated_at FROM price_guides ORDER BY updated_at DESC, id DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/notices/price-guides', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { title, content, color } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });
    db.run(
        "INSERT INTO price_guides (title, content, color, created_by, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        [String(title).trim(), String(content || '').trim(), String(color || '#f8fafc').trim(), req.userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.put('/api/notices/price-guides/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { title, content, color } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required.' });
    db.run(
        "UPDATE price_guides SET title = ?, content = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [String(title).trim(), String(content || '').trim(), String(color || '#f8fafc').trim(), req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Price guide not found.' });
            res.json({ success: true });
        }
    );
});

app.delete('/api/notices/price-guides/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM price_guides WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Price guide not found.' });
        res.json({ success: true });
    });
});

app.get('/api/notices/prices', verifyToken, (req, res) => {
    db.all("SELECT id, category, item_name, price, created_by, created_at, updated_at FROM price_items ORDER BY category ASC, item_name ASC, id DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/notices/prices', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { category, item_name, price } = req.body;
    if (!category || !item_name || !price) return res.status(400).json({ error: 'category, item_name, price are required.' });
    db.run(
        "INSERT INTO price_items (category, item_name, price, created_by, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        [String(category).trim(), String(item_name).trim(), String(price).trim(), req.userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.put('/api/notices/prices/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { category, item_name, price } = req.body;
    if (!category || !item_name || !price) return res.status(400).json({ error: 'category, item_name, price are required.' });
    db.run(
        "UPDATE price_items SET category = ?, item_name = ?, price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [String(category).trim(), String(item_name).trim(), String(price).trim(), req.params.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Price item not found.' });
            res.json({ success: true });
        }
    );
});

app.delete('/api/notices/prices/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM price_items WHERE id = ?", [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Price item not found.' });
        res.json({ success: true });
    });
});

const BOSS_CONTROL_CHAPTERS = [
    { chapter: '요툰하임', bosses: ['파르바', '셀로비아', '흐니르', '페티', '바우티', '니드호그', '야른'] },
    { chapter: '니다벨리르', bosses: ['라이노르', '비요른', '헤르모드', '스칼라니르', '브륀힐드', '라타토스크', '수드리'] },
    { chapter: '알브하임', bosses: ['스바르트', '두라스로르', '모네가름', '드라우그', '굴베이그'] },
    { chapter: '무스펠하임', bosses: ['메기르', '신마라', '헤르가름', '탕그리스니르', '엘드룬', '우로보로스'] },
    { chapter: '아스가르드', bosses: ['발리', '노트', '샤무크', '스칼드메르', '그로아'] },
    { chapter: '니플하임', bosses: ['히로킨', '호드', '헤이드', '프레이'] },
    { chapter: '절대자', bosses: ['티르', '토르', '오딘', '수르트', '미미르', '이미르'] },
    { chapter: '지하감옥', bosses: ['최하층굴베', '최하층강글', '최하층스네르', '4층', '7층', '10층'] },
    { chapter: '성채', bosses: ['2층', '3층', '4층', '5층', '6층', '7층', '8층'] },
    { chapter: '지옥성채', bosses: ['1시 보스', '7시 보스', '이미르'] },
    { chapter: '로키(필드)', bosses: ['요툰하임', '니다벨리르', '알브하임', '무스펠하임', '아스가르드', '니플하임', '바나하임'] },
    { chapter: '로키(균열)', bosses: ['1단계', '2단계', '3단계', '4단계', '5단계'] }
];
const BOSS_CONTROL_STATUS = new Set(['CONTROL', 'ALLY_ONLY', 'NONE']);

app.get('/api/notices/boss-controls', verifyToken, (req, res) => {
    db.all("SELECT chapter, boss, status, updated_at FROM boss_control_states", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const statusMap = new Map();
        (rows || []).forEach(r => {
            statusMap.set(`${r.chapter}::${r.boss}`, BOSS_CONTROL_STATUS.has(r.status) ? r.status : 'NONE');
        });

        const chapters = BOSS_CONTROL_CHAPTERS.map(c => ({
            chapter: c.chapter,
            bosses: c.bosses.map(boss => ({
                name: boss,
                status: statusMap.get(`${c.chapter}::${boss}`) || 'NONE'
            }))
        }));

        res.json({ chapters });
    });
});

app.put('/api/notices/boss-controls', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { chapter, boss, status } = req.body || {};
    const chapterObj = BOSS_CONTROL_CHAPTERS.find(c => c.chapter === chapter);
    if (!chapterObj || !chapterObj.bosses.includes(boss)) return res.status(400).json({ error: 'Invalid chapter/boss.' });
    if (!BOSS_CONTROL_STATUS.has(status)) return res.status(400).json({ error: 'Invalid status.' });

    db.run(
        `INSERT INTO boss_control_states (chapter, boss, status, updated_by, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chapter, boss) DO UPDATE SET
           status = excluded.status,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
        [chapter, boss, status, req.userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// --- SETTINGS ---
app.get('/api/settings', (req, res) => {
    db.get("SELECT guild_name, discord_token, discord_channel_id, discord_enabled, allow_member_combat_power_edit FROM odin_settings LIMIT 1", (err, row) => {
        res.json(row || { guild_name: '오딘 길드', discord_token: '', discord_channel_id: '', discord_enabled: 1, allow_member_combat_power_edit: 1 });
    });
});

app.post('/api/settings', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { guild_name, discord_token, discord_channel_id, discord_enabled, allow_member_combat_power_edit } = req.body;
    const requestedAllowCombatPowerEdit = parseInt(allow_member_combat_power_edit) === 0 ? 0 : 1;

    // UPSERT style: Try to update first available row first.
    db.get("SELECT rowid as id, allow_member_combat_power_edit FROM odin_settings LIMIT 1", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'DB Error while checking settings: ' + err.message });
        }

        const allowCombatPowerEdit = req.userRole === 'MASTER'
            ? requestedAllowCombatPowerEdit
            : (row && row.allow_member_combat_power_edit === 0 ? 0 : 1);

        if (row) {
            // Update existing row
            db.run("UPDATE odin_settings SET guild_name = ?, discord_token = ?, discord_channel_id = ?, discord_enabled = ?, allow_member_combat_power_edit = ? WHERE rowid = ?",
                [guild_name, discord_token, discord_channel_id, discord_enabled, allowCombatPowerEdit, row.id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update settings: ' + err.message });
                    }
                    isDiscordEnabled = parseInt(discord_enabled) === 1;
                    if (discord_token && discord_channel_id) initDiscordBot(discord_token, discord_channel_id);
                    res.json({ success: true });
                });
        } else {
            // Insert new row
            db.run("INSERT INTO odin_settings (guild_name, discord_token, discord_channel_id, discord_enabled, allow_member_combat_power_edit) VALUES (?, ?, ?, ?, ?)",
                [guild_name, discord_token, discord_channel_id, discord_enabled, allowCombatPowerEdit], (err) => {
                    if (err) {
                        console.error('❌ Settings Insert Error:', err.message);
                        return res.status(500).json({ error: 'Failed to insert settings: ' + err.message });
                    }
                    isDiscordEnabled = parseInt(discord_enabled) === 1;
                    if (discord_token && discord_channel_id) initDiscordBot(discord_token, discord_channel_id);
                    res.json({ success: true });
                });
        }
    });
});

app.post('/api/test-discord', verifyToken, async (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    if (!discordClient || !discordClient.isReady() || !discordChannelId) {
        return res.status(400).json({ error: 'Bot is not ready or channel ID is missing.' });
    }
    try {
        const channel = await discordClient.channels.fetch(discordChannelId);
        if (!channel) return res.status(400).json({ error: 'Channel not found.' });

        // Fetch guild name for the message to avoid ReferenceError
        db.get("SELECT guild_name FROM odin_settings LIMIT 1", async (err, row) => {
            const gName = (row && row.guild_name) ? row.guild_name : '오딘 길드';
            await channel.send({ content: `${gName} 디스코드 봇 알림이 연동되었습니다! (TTS)`, tts: true });
            res.json({ success: true });
        });
    } catch (err) {
        res.status(500).json({ error: `Discord Error: ${err.message}. Please check if the bot is in the server AND the Channel ID is correct.` });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
