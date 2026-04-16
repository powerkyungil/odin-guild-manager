const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'odin-guild-secret-kyeongil';

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
    res.json({ serverTime: Date.now() });
});

// --- Auth Routes ---
const dbPath = path.resolve(__dirname, 'database.sqlite');
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
            skills TEXT
        )`);

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

        // Settings Table (Renamed to odin_settings to avoid conflict with existing tables)
        db.run(`CREATE TABLE IF NOT EXISTS odin_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_name TEXT DEFAULT '오딘 길드',
            discord_token TEXT,
            discord_channel_id TEXT,
            discord_enabled INTEGER DEFAULT 1
        )`, () => {
            // Migration: Add discord_enabled to existing odin_settings table if it doesn't exist
            db.all("PRAGMA table_info(odin_settings)", (err, rows) => {
                if (rows && !rows.find(r => r.name === 'discord_enabled')) {
                    db.run("ALTER TABLE odin_settings ADD COLUMN discord_enabled INTEGER DEFAULT 1");
                }

                // CRITICAL: Ensure at least one row exists
                db.get("SELECT count(*) as cnt FROM odin_settings", (err, row) => {
                    if (row && row.cnt === 0) {
                        db.run("INSERT INTO odin_settings (guild_name, discord_enabled) VALUES ('오딘 길드', 1)");
                    }
                });
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
            if (!err) {
                db.get("SELECT COUNT(*) as count FROM collections", (err, row) => {
                    if (row && row.count === 0) {
                        try {
                            const fs = require('fs');
                            const dataPath = path.join(__dirname, 'collections_data.js');
                            if (fs.existsSync(dataPath)) {
                                let content = fs.readFileSync(dataPath, 'utf8');
                                const startIdx = content.indexOf('[');
                                const endIdx = content.lastIndexOf(']');
                                if (startIdx !== -1 && endIdx !== -1) {
                                    const jsonStr = content.substring(startIdx, endIdx + 1);
                                    const collections = JSON.parse(jsonStr);
                                    const stmt = db.prepare("INSERT INTO collections (name, items) VALUES (?, ?)");
                                    collections.forEach(c => stmt.run([c.name, JSON.stringify(c.items)]));
                                    stmt.finalize();
                                }
                            }
                        } catch (e) {
                            // Error seeding collections
                        }
                    }
                });
            }
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
    expiresAt.setDate(expiresAt.getDate() + 1);
    db.run("INSERT INTO invitations (token, role, created_by, expires_at) VALUES (?, ?, ?, ?)", [token, targetRole || 'MEMBER', req.userId, expiresAt.toISOString()], (err) => {
        if (err) return res.status(500).json({ error: 'Error generating invite.' });
        res.json({ inviteToken: token, role: targetRole || 'MEMBER' });
    });
});

app.post('/api/users/register', (req, res) => {
    const { token, username, password, nickname, occupation, main_class, combat_power, equipment, skills } = req.body;
    if (!username || !password || !nickname) return res.status(400).json({ error: 'Missing required fields.' });
    db.get("SELECT * FROM invitations WHERE token = ? AND is_used = 0", [token], (err, invite) => {
        if (err || !invite) return res.status(400).json({ error: 'Invalid token.' });
        const hash = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (username, password_hash, role, nickname, occupation, main_class, combat_power, equipment, skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hash, invite.role, nickname, occupation, main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills)], function (err) {
                if (err) return res.status(400).json({ error: 'Username exists.' });
                db.run("UPDATE invitations SET is_used = 1 WHERE token = ?", [token]);
                res.json({ success: true });
            });
    });
});

app.get('/api/users/me', verifyToken, (req, res) => {
    db.get("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills FROM users WHERE id = ?", [req.userId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'User not found.' });
        res.json(row);
    });
});

app.put('/api/users/me', verifyToken, (req, res) => {
    const { password, nickname, occupation, main_class, combat_power, equipment, skills } = req.body;
    let sql = `UPDATE users SET nickname = ?, occupation = ?, main_class = ?, combat_power = ?, equipment = ?, skills = ?`;
    let params = [nickname, occupation, main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills)];
    if (password && password.trim() !== "") {
        params.push(bcrypt.hashSync(password, 10));
        sql += `, password_hash = ?`;
    }
    sql += ` WHERE id = ?`;
    params.push(req.userId);
    db.run(sql, params, () => res.json({ success: true }));
});

app.get('/api/users', verifyToken, (req, res) => {
    db.all("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills FROM users", (err, rows) => res.json(rows));
});

// --- BOSS API ---
const BOSS_TIMERS = {
    "4층분노의모네가름": 12 * 3600, "스칼라니르": 12 * 3600, "니드호그": 12 * 3600, "라이노르": 12 * 3600, "라타토스크": 12 * 3600, "바우티": 12 * 3600, "야른": 12 * 3600, "브륀힐드": 12 * 3600, "비요른": 12 * 3600, "셀로비아": 12 * 3600, "수드리": 12 * 3600, "페티": 12 * 3600, "파르바": 12 * 3600, "헤르모드": 12 * 3600, "흐니르": 12 * 3600,
    "7층나태의드라우그": 24 * 3600, "굴베이그": 24 * 3600, "두라스로르": 24 * 3600, "드라우그": 24 * 3600, "스바르트": 24 * 3600, "모네가름": 24 * 3600,
    "우로보로스": 36 * 3600, "10층다인홀로크": 36 * 3600, "최하층강글": 36 * 3600, "메기르": 36 * 3600, "탕그리스니르": 36 * 3600, "최하층굴베": 36 * 3600, "헤르가름": 36 * 3600, "신마라": 36 * 3600, "엘드룬": 36 * 3600,
    "발리": 48 * 3600, "샤무크": 48 * 3600, "스칼드메르": 48 * 3600, "노트": 48 * 3600, "그로아": 48 * 3600,
    "헤이드": 60 * 3600, "호드": 60 * 3600, "히로킨": 60 * 3600,
    "수르트": 72 * 3600, "오딘": 72 * 3600, "최하층스네르": 72 * 3600, "토르": 72 * 3600, "티르": 72 * 3600, "미미르": 72 * 3600,
    "이미르": 120 * 3600
};

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
    const cooldown = BOSS_TIMERS[boss];
    if (!cooldown) return res.status(400).json({ error: 'No cooldown.' });
    const spawnTime = Date.now() + (cooldown * 1000);
    db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], () => {
        db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);
        db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by, is_mung) VALUES (?, ?, ?, ?, ?, 0)", [type, region, boss, spawnTime, req.userId], () => res.json({ success: true, nextSpawn: spawnTime }));
    });
});

app.post('/api/schedules/mung', verifyToken, (req, res) => {
    const { type, region, boss, currentSpawnTime } = req.body;
    const cooldown = BOSS_TIMERS[boss];
    if (!cooldown) return res.status(400).json({ error: 'No cooldown.' });
    const nextSpawn = parseInt(currentSpawnTime) + (cooldown * 1000);
    db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", [boss, region, type], () => {
        db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);
        db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by, is_mung) VALUES (?, ?, ?, ?, ?, 1)", [type, region, boss, nextSpawn, req.userId], () => res.json({ success: true, nextSpawn: nextSpawn }));
    });
});

app.delete('/api/schedules/:id', verifyToken, (req, res) => {
    db.run("DELETE FROM boss_schedules WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

app.delete('/api/schedules-all', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM boss_schedules", () => res.json({ success: true }));
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

app.get('/api/user-collections', verifyToken, (req, res) => {
    db.all("SELECT user_id, collection_name FROM user_collections", (err, rows) => res.json(rows));
});

app.post('/api/user-collections/toggle', verifyToken, (req, res) => {
    const { userId, collectionName } = req.body;
    if (req.userId !== parseInt(userId) && req.userRole === 'MEMBER') return res.status(403).json({ error: 'Denied.' });
    db.get("SELECT * FROM user_collections WHERE user_id = ? AND collection_name = ?", [userId, collectionName], (err, row) => {
        if (row) db.run("DELETE FROM user_collections WHERE user_id = ? AND collection_name = ?", [userId, collectionName], () => res.json({ status: 'removed' }));
        else db.run("INSERT INTO user_collections (user_id, collection_name) VALUES (?, ?)", [userId, collectionName], () => res.json({ status: 'added' }));
    });
});

app.get('/api/collections', verifyToken, (req, res) => {
    db.all("SELECT * FROM collections ORDER BY id ASC", (err, rows) => res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) }))));
});

app.post('/api/collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("INSERT INTO collections (name, items) VALUES (?, ?)", [req.body.name, JSON.stringify(req.body.items)], function () { res.json({ success: true, id: this.lastID }); });
});

app.delete('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("DELETE FROM collections WHERE id = ?", [req.params.id], () => res.json({ success: true }));
});

app.put('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    db.run("UPDATE collections SET name = ?, items = ? WHERE id = ?", [req.body.name, JSON.stringify(req.body.items), req.params.id], () => res.json({ success: true }));
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
                try { await runSql("ROLLBACK"); } catch (_) {}
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

// --- SETTINGS ---
app.get('/api/settings', (req, res) => {
    db.get("SELECT guild_name, discord_token, discord_channel_id, discord_enabled FROM odin_settings LIMIT 1", (err, row) => {
        res.json(row || { guild_name: '오딘 길드', discord_token: '', discord_channel_id: '', discord_enabled: 1 });
    });
});

app.post('/api/settings', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { guild_name, discord_token, discord_channel_id, discord_enabled } = req.body;

    // UPSERT style: Try to update first available row first.
    db.get("SELECT rowid as id FROM odin_settings LIMIT 1", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'DB Error while checking settings: ' + err.message });
        }

        if (row) {
            // Update existing row
            db.run("UPDATE odin_settings SET guild_name = ?, discord_token = ?, discord_channel_id = ?, discord_enabled = ? WHERE rowid = ?",
                [guild_name, discord_token, discord_channel_id, discord_enabled, row.id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to update settings: ' + err.message });
                    }
                    isDiscordEnabled = parseInt(discord_enabled) === 1;
                    if (discord_token && discord_channel_id) initDiscordBot(discord_token, discord_channel_id);
                    res.json({ success: true });
                });
        } else {
            // Insert new row
            db.run("INSERT INTO odin_settings (guild_name, discord_token, discord_channel_id, discord_enabled) VALUES (?, ?, ?, ?)",
                [guild_name, discord_token, discord_channel_id, discord_enabled], (err) => {
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

app.listen(PORT, () => {
    // Server running
});
