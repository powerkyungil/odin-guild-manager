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

function initDiscordBot(token, channelId) {
    if (discordClient) {
        discordClient.destroy();
    }
    discordChannelId = channelId;
    discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    
    discordClient.once('clientReady', () => {
        console.log(`✅ Discord Bot logged in as ${discordClient.user.tag}`);
    });

    discordClient.login(token).catch(err => {
        console.error('❌ Discord login failed:', err.message);
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

    db.all("SELECT id, boss, spawnTime FROM boss_schedules WHERE spawnTime > ? AND spawnTime <= ?", [windowMin, windowMax], (err, bosses) => {
        if (err) {
            console.error('❌ Polling DB Error:', err.message);
            return;
        }
        if (bosses && bosses.length > 0) {
            bosses.forEach(b => {
                const diffMin = (b.spawnTime - now) / (60 * 1000);
                let alertType = null;
                let content = '';

                // 5-minute alert (4.5m ~ 5.5m)
                if (diffMin > 4.5 && diffMin <= 5.5) {
                    alertType = '5min';
                    content = `${b.boss} 5분 전입니다.`;
                } 
                // 1-minute alert (0.5m ~ 1.5m)
                else if (diffMin > 0.5 && diffMin <= 1.5) {
                    alertType = '1min';
                    content = `${b.boss} 1분 전입니다.`;
                }

                if (alertType) {
                    const notifyKey = `${b.id}_${alertType}`;
                    if (!notifiedBosses.has(notifyKey)) {
                        discordClient.channels.fetch(discordChannelId)
                            .then(channel => {
                                if (channel) {
                                    channel.send({ content, tts: true }).then(() => {
                                        console.log(`✅ [${alertType}] TTS Sent for ${b.boss}`);
                                        notifiedBosses.add(notifyKey);
                                        // Auto cleanup after 15 mins
                                        setTimeout(() => notifiedBosses.delete(notifyKey), 15 * 60 * 1000);
                                    }).catch(e => console.error('❌ Send Err:', e.message));
                                }
                            }).catch(err => console.error('❌ Fetch Err:', err.message));
                    }
                }
            });
        }
    });
}, 30000);

// --- DB Setup ---
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDB();
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
                    console.log("✅ Database Migrated: Added 'is_mung' to boss_schedules");
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

        // Settings Table
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_name TEXT DEFAULT '오딘 길드',
            discord_token TEXT,
            discord_channel_id TEXT
        )`);

        // Discord Bot Auth - Try auto-login
        db.get("SELECT discord_token, discord_channel_id FROM settings WHERE id = 1", (err, row) => {
            if (row && row.discord_token && row.discord_channel_id) {
                initDiscordBot(row.discord_token, row.discord_channel_id);
            }
        });

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
                                    console.log(`✅ Seeded ${collections.length} collections`);
                                }
                            }
                        } catch (e) {
                            console.error('Error seeding collections:', e);
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
        const token = jwt.sign({ id: user.id, role: user.role, username: user.username, nickname: user.nickname }, JWT_SECRET, { expiresIn: '24h' });
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
            [username, hash, invite.role, nickname, occupation, main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills)], function(err) {
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
    db.run("INSERT INTO collections (name, items) VALUES (?, ?)", [req.body.name, JSON.stringify(req.body.items)], function() { res.json({ success: true, id: this.lastID }); });
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
    db.get("SELECT role FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (user.role === 'MASTER') return res.status(403).json({ error: 'Master role protected.' });
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM user_collections WHERE user_id = ?", [req.params.id]);
            db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
            db.run("COMMIT", () => res.json({ success: true }));
        });
    });
});

// --- SETTINGS ---
app.get('/api/settings', (req, res) => {
    db.get("SELECT guild_name, discord_token, discord_channel_id FROM settings LIMIT 1", (err, row) => {
        res.json(row || { guild_name: '오딘 길드', discord_token: '', discord_channel_id: '' });
    });
});

app.post('/api/settings', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') return res.status(403).json({ error: 'Unauthorized.' });
    const { guild_name, discord_token, discord_channel_id } = req.body;
    
    // UPSERT style: Try to update row 1 first. If not found, insert.
    db.get("SELECT id FROM settings LIMIT 1", (err, row) => {
        if (err) {
            console.error('❌ Settings Check Error:', err.message);
            return res.status(500).json({ error: 'DB Error while checking settings: ' + err.message });
        }

        if (row) {
            // Update existing row
            db.run("UPDATE settings SET guild_name = ?, discord_token = ?, discord_channel_id = ? WHERE id = ?", 
                [guild_name, discord_token, discord_channel_id, row.id], (err) => {
                if (err) {
                    console.error('❌ Settings Update Error:', err.message);
                    return res.status(500).json({ error: 'Failed to update settings: ' + err.message });
                }
                if (discord_token && discord_channel_id) initDiscordBot(discord_token, discord_channel_id);
                res.json({ success: true });
            });
        } else {
            // Insert new row
            db.run("INSERT INTO settings (guild_name, discord_token, discord_channel_id) VALUES (?, ?, ?)", 
                [guild_name, discord_token, discord_channel_id], (err) => {
                if (err) {
                    console.error('❌ Settings Insert Error:', err.message);
                    return res.status(500).json({ error: 'Failed to insert settings: ' + err.message });
                }
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
        db.get("SELECT guild_name FROM settings WHERE id = 1", async (err, row) => {
            const gName = (row && row.guild_name) ? row.guild_name : '오딘 길드';
            await channel.send({ content: `${gName} 디스코드 봇 알림이 연동되었습니다! (TTS)`, tts: true });
            res.json({ success: true });
        });
    } catch (err) {
        console.error('❌ Test Discord Error Details:', err);
        res.status(500).json({ error: `Discord Error: ${err.message}. Please check if the bot is in the server AND the Channel ID is correct.` });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
