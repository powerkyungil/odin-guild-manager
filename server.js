const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'odin-guild-secret-kyeongil'; // Use env var for prod

app.use(cors());
app.use(express.json());
// Static files serving (HTML, CSS, JS)
app.use(express.static(__dirname));

// DB Setup
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
        )`, (err) => {
            if (!err) {
                // Add columns if they don't exist (for existing DBs)
                const columns = [
                    ['nickname', 'TEXT'],
                    ['occupation', 'TEXT'],
                    ['main_class', 'TEXT'],
                    ['combat_power', 'INTEGER'],
                    ['equipment', 'TEXT'],
                    ['skills', 'TEXT']
                ];
                columns.forEach(col => {
                    db.run(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`, (err) => {
                        // Ignore error if column already exists
                    });
                });
            }
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

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
            key TEXT PRIMARY KEY,
            value TEXT
        )`, (err) => {
            if (!err) {
                db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('guild_name', '오딘 길드')");
            }
        });

        // NEW: Collections Metadata Table
        db.run(`CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            items TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (!err) {
                // If the table was just created, seed it from collections_data.js if it exists
                db.get("SELECT COUNT(*) as count FROM collections", (err, row) => {
                    if (row && row.count === 0) {
                        try {
                            const fs = require('fs');
                            const dataPath = path.join(__dirname, 'collections_data.js');
                            if (fs.existsSync(dataPath)) {
                                let content = fs.readFileSync(dataPath, 'utf8');
                                // Extract the array part from "const COLLECTIONS_DATA = [...];"
                                const startIdx = content.indexOf('[');
                                const endIdx = content.lastIndexOf(']');
                                if (startIdx !== -1 && endIdx !== -1) {
                                    const jsonStr = content.substring(startIdx, endIdx + 1);
                                    const collections = JSON.parse(jsonStr);
                                    const stmt = db.prepare("INSERT INTO collections (name, items) VALUES (?, ?)");
                                    collections.forEach(c => {
                                        stmt.run([c.name, JSON.stringify(c.items)]);
                                    });
                                    stmt.finalize();
                                    console.log(`✅ Seeded ${collections.length} collections from collections_data.js`);
                                }
                            }
                        } catch (e) {
                            console.error('Error seeding collections:', e);
                        }
                    }
                });
            }
        });

        // Create initial Guild Master if none exists
        db.get("SELECT * FROM users WHERE role = 'MASTER'", (err, row) => {
            if (!row) {
                const masterUsername = 'master';
                const masterPassword = 'password123'; // Default master password
                const hash = bcrypt.hashSync(masterPassword, 10);
                
                db.run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [masterUsername, hash, 'MASTER'], (err) => {
                    if (!err) console.log('✅ Initial Guild Master account created (ID: master, PW: password123)');
                });
            }
        });
    });
}

// Middleware to verify JWT
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

// --- API ROUTES ---

// 1. Login
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

// 2. Generate Invite Token (Master/Admin only)
app.post('/api/invites', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { targetRole } = req.body; // 'ADMIN' or 'MEMBER'
    // Only MASTER can create ADMIN
    if (targetRole === 'ADMIN' && req.userRole !== 'MASTER') {
        return res.status(403).json({ error: 'Only Master can invite Admins.' });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1); // 1 day validity

    db.run("INSERT INTO invitations (token, role, created_by, expires_at) VALUES (?, ?, ?, ?)",
        [token, targetRole || 'MEMBER', req.userId, expiresAt.toISOString()],
        (err) => {
            if (err) return res.status(500).json({ error: 'Error generating invite.' });
            res.json({ inviteToken: token, role: targetRole || 'MEMBER' });
        });
});

// 3. Register user via token
app.post('/api/users/register', (req, res) => {
    const { token, username, password, nickname, occupation, main_class, combat_power, equipment, skills } = req.body;

    if (!username || !password || !nickname) return res.status(400).json({ error: 'Username, password, and nickname required.' });

    db.get("SELECT * FROM invitations WHERE token = ? AND is_used = 0", [token], (err, invite) => {
        if (err || !invite) return res.status(400).json({ error: 'Invalid or used token.' });
        if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired.' });

        const hash = bcrypt.hashSync(password, 10);
        
        const sql = `INSERT INTO users (
            username, password_hash, role, nickname, occupation, 
            main_class, combat_power, equipment, skills
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(sql, [
            username, hash, invite.role, nickname, occupation,
            main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills)
        ], function(err) {
            if (err) return res.status(400).json({ error: 'Username already exists.' });
            
            // Mark token as used
            db.run("UPDATE invitations SET is_used = 1 WHERE token = ?", [token]);
            res.json({ success: true, message: 'Account created successfully. You can now log in.' });
        });
    });
});

// 4. Get Current User Info
app.get('/api/users/me', verifyToken, (req, res) => {
    db.get("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills FROM users WHERE id = ?", [req.userId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'User not found.' });
        res.json(row);
    });
});

// 5. Update Current User Info
app.put('/api/users/me', verifyToken, (req, res) => {
    const { password, nickname, occupation, main_class, combat_power, equipment, skills } = req.body;

    let sql = `UPDATE users SET 
        nickname = ?, occupation = ?, main_class = ?, 
        combat_power = ?, equipment = ?, skills = ?`;
    let params = [nickname, occupation, main_class, combat_power, JSON.stringify(equipment), JSON.stringify(skills)];

    // Update password if provided
    if (password && password.trim() !== "") {
        const hash = bcrypt.hashSync(password, 10);
        sql += `, password_hash = ?`;
        params.push(hash);
    }

    sql += ` WHERE id = ?`;
    params.push(req.userId);

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: 'Update failed.' });
        res.json({ success: true, message: 'Profile updated.' });
    });
});

// 6. Get User List (Master/Admin/Member)
app.get('/api/users', verifyToken, (req, res) => {
    db.all("SELECT id, role, nickname, occupation, main_class, combat_power, equipment, skills FROM users", (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error.' });
        res.json(rows);
    });
});

// --- BOSS SCHEDULE API ---

// Boss Cooldown Mapping (in seconds)
const BOSS_TIMERS = {
    // 12시간 (012:00:00)
    "4층분노의모네가름": 12 * 3600, "스칼라니르": 12 * 3600, "니드호그": 12 * 3600, 
    "라이노르": 12 * 3600, "라타토스크": 12 * 3600, "바우티": 12 * 3600, 
    "야른": 12 * 3600, "브륀힐드": 12 * 3600, "비요른": 12 * 3600, 
    "셀로비아": 12 * 3600, "수드리": 12 * 3600, "페티": 12 * 3600, 
    "파르바": 12 * 3600, "헤르모드": 12 * 3600, "흐니르": 12 * 3600,
    
    // 24시간 (024:00:00)
    "7층나태의드라우그": 24 * 3600, "굴베이그": 24 * 3600, "두라스로르": 24 * 3600,
    "드라우그": 24 * 3600, "스바르트": 24 * 3600, "모네가름": 24 * 3600,
    
    // 36시간 (036:00:00)
    "우로보로스": 36 * 3600, "10층다인홀로크": 36 * 3600, "최하층강글": 36 * 3600,
    "메기르": 36 * 3600, "탕그리스니르": 36 * 3600, "최하층굴베": 36 * 3600,
    "헤르가름": 36 * 3600, "신마라": 36 * 3600, "엘드룬": 36 * 3600,
    
    // 48시간 (048:00:00)
    "발리": 48 * 3600, "샤무크": 48 * 3600, "스칼드메르": 48 * 3600, "노트": 48 * 3600, "그로아": 48 * 3600,
    
    // 60시간 (060:00:00)
    "헤이드": 60 * 3600, "호드": 60 * 3600, "히로킨": 60 * 3600,
    
    // 72시간 (072:00:00)
    "수르트": 72 * 3600, "오딘": 72 * 3600, "최하층스네르": 72 * 3600, 
    "토르": 72 * 3600, "티르": 72 * 3600, "미미르": 72 * 3600,
    
    // 120시간 (120:00:00)
    "이미르": 120 * 3600
};

// 7. Get All Schedules
app.get('/api/schedules', verifyToken, (req, res) => {
    db.all("SELECT * FROM boss_schedules ORDER BY spawnTime ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error.' });
        res.json(rows);
    });
});

// 8. Add/Save Schedules (Batch)
app.post('/api/schedules', verifyToken, (req, res) => {
    const schedules = req.body; // Array of { type, region, boss, spawnTime }
    if (!Array.isArray(schedules)) return res.status(400).json({ error: 'Invalid data format.' });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        schedules.forEach(s => {
            // Overwrite: delete existing entry for same boss in same region/type
            db.run("DELETE FROM boss_schedules WHERE type = ? AND region = ? AND boss = ?", [s.type, s.region, s.boss]);
            // Clear existing participants when schedule resets
            db.run("DELETE FROM boss_participants WHERE boss = ?", [s.boss]);
            
            db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by) VALUES (?, ?, ?, ?, ?)", 
                [s.type, s.region, s.boss, s.spawnTime, req.userId]);
        });
        db.run("COMMIT", (err) => {
            if (err) {
                console.error('Transaction Error:', err);
                return res.status(500).json({ error: 'Failed to save schedules.' });
            }
            res.json({ success: true });
        });
    });
});

// 8.5 [NEW] Process Boss "Cut" (Auto recalculate next spawn)
app.post('/api/schedules/cut', verifyToken, (req, res) => {
    const { type, region, boss } = req.body;
    if (!type || !region || !boss) return res.status(400).json({ error: 'Missing data.' });

    if (type === '침공') return res.status(400).json({ error: 'Invasion bosses do not support auto-cut.' });

    const cooldown = BOSS_TIMERS[boss];
    if (!cooldown) return res.status(400).json({ error: 'No cooldown data for this boss.' });

    const spawnTime = Date.now() + (cooldown * 1000);

    db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", 
        [boss, region, type], (err) => {
        if (err) console.error(err);
        
        db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);

        db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by) VALUES (?, ?, ?, ?, ?)",
            [type, region, boss, spawnTime, req.userId], function(err) {
                if (err) return res.status(500).json({ error: 'Failed to record cut.' });
                res.json({ success: true, nextSpawn: spawnTime });
            }
        );
    });
});

app.post('/api/schedules/mung', verifyToken, (req, res) => {
    const { type, region, boss, currentSpawnTime } = req.body;
    if (!type || !region || !boss || !currentSpawnTime) return res.status(400).json({ error: 'Missing data.' });

    if (type === '침공') return res.status(400).json({ error: 'Invasion bosses do not support auto-scheduling.' });

    const cooldown = BOSS_TIMERS[boss];
    if (!cooldown) return res.status(400).json({ error: 'No cooldown data for this boss.' });

    const nextSpawn = parseInt(currentSpawnTime) + (cooldown * 1000);

    db.run("DELETE FROM boss_schedules WHERE boss = ? AND region = ? AND type = ?", 
        [boss, region, type], (err) => {
        if (err) console.error(err);
        
        db.run("DELETE FROM boss_participants WHERE boss = ?", [boss]);

        db.run("INSERT INTO boss_schedules (type, region, boss, spawnTime, created_by) VALUES (?, ?, ?, ?, ?)",
            [type, region, boss, nextSpawn, req.userId], function(err) {
                if (err) return res.status(500).json({ error: 'Failed to record mung.' });
                res.json({ success: true, nextSpawn: nextSpawn });
            }
        );
    });
});


// 9. Delete Specific Schedule
app.delete('/api/schedules/:id', verifyToken, (req, res) => {
    db.run("DELETE FROM boss_schedules WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Delete failed.' });
        res.json({ success: true });
    });
});

// 10. Clear All Schedules
app.delete('/api/schedules-all', verifyToken, (req, res) => {
    db.run("DELETE FROM boss_schedules", (err) => {
        if (err) return res.status(500).json({ error: 'Clear failed.' });
        res.json({ success: true });
    });
});

// --- ITEM COLLECTIONS API ---

// 11. Get All User Collection Progress
app.get('/api/user-collections', verifyToken, (req, res) => {
    db.all("SELECT user_id, collection_name FROM user_collections", (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error.' });
        res.json(rows);
    });
});

// 12. Toggle Collection Completion
app.post('/api/user-collections/toggle', verifyToken, (req, res) => {
    const { userId, collectionName } = req.body;
    
    // Permission check: Only self or Admin/Master
    if (req.userId !== parseInt(userId) && req.userRole === 'MEMBER') {
        return res.status(403).json({ error: 'Permission denied.' });
    }

    db.get("SELECT * FROM user_collections WHERE user_id = ? AND collection_name = ?", [userId, collectionName], (err, row) => {
        if (row) {
            db.run("DELETE FROM user_collections WHERE user_id = ? AND collection_name = ?", [userId, collectionName], (err) => {
                if (err) return res.status(500).json({ error: 'Database error.' });
                res.json({ status: 'removed' });
            });
        } else {
            db.run("INSERT INTO user_collections (user_id, collection_name) VALUES (?, ?)", [userId, collectionName], (err) => {
                if (err) return res.status(500).json({ error: 'Database error.' });
                res.json({ status: 'added' });
            });
        }
    });
});

// 13. Get All Collections Metadata
app.get('/api/collections', verifyToken, (req, res) => {
    db.all("SELECT * FROM collections ORDER BY id ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error.' });
        // Parse items JSON for each row
        const formatted = rows.map(r => ({
            ...r,
            items: JSON.parse(r.items)
        }));
        res.json(formatted);
    });
});

// 14. Add New Collection (Master/Admin only)
app.post('/api/collections', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { name, items } = req.body; // { name: string, items: string[] }
    if (!name || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid data.' });

    db.run("INSERT INTO collections (name, items) VALUES (?, ?)", [name, JSON.stringify(items)], function(err) {
        if (err) return res.status(400).json({ error: 'Collection already exists or DB error.' });
        res.json({ success: true, id: this.lastID });
    });
});

// 15. Delete Collection (Master/Admin only)
app.delete('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    db.run("DELETE FROM collections WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Delete failed.' });
        res.json({ success: true });
    });
});
// 16. Update Collection (Master/Admin only)
app.put('/api/collections/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER' && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { name, items } = req.body;
    if (!name || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid data.' });

    db.run("UPDATE collections SET name = ?, items = ? WHERE id = ?", [name, JSON.stringify(items), req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Update failed.' });
        res.json({ success: true });
    });
});



// 17. Update User Role (Master only)
app.put('/api/admin/users/:id/role', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') {
        return res.status(403).json({ error: 'Unauthorized. Only Master can change roles.' });
    }

    const { role } = req.body;
    if (!['ADMIN', 'MEMBER'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });

    // Prevent Changing of Other Masters or self
    db.get("SELECT role FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found.' });
        if (user.role === 'MASTER') return res.status(403).json({ error: 'Cannot change Master role.' });

        db.run("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id], function(err) {
            if (err) return res.status(500).json({ error: 'Role update failed.' });
            res.json({ success: true, message: 'User role updated.' });
        });
    });
});

// 18. Delete User (Master only)
app.delete('/api/admin/users/:id', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') {
        return res.status(403).json({ error: 'Unauthorized. Only Master can delete users.' });
    }

    db.get("SELECT role FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found.' });
        if (user.role === 'MASTER') return res.status(403).json({ error: 'Cannot delete Master.' });

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM user_collections WHERE user_id = ?", [req.params.id]);
            db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
            db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: 'Delete failed.' });
                res.json({ success: true, message: 'User deleted.' });
            });
        });
    });
});

// ============================================
// Participation Management APIs
// ============================================

// Toggle participation status
app.post('/api/participants/:boss', verifyToken, (req, res) => {
    const boss = req.params.boss;
    const nicknameFromReq = req.userNickname || (req.body && req.body.nickname); 
    
    // Safety: always use the DB nickname to be sure
    db.get("SELECT nickname FROM users WHERE id = ?", [req.userId], (err, row) => {
        if (err || !row) return res.status(403).json({ error: 'User not found.' });
        const userNick = row.nickname;

        db.get("SELECT * FROM boss_participants WHERE boss = ? AND nickname = ?", [boss, userNick], (err, existing) => {
            if (existing) {
                db.run("DELETE FROM boss_participants WHERE boss = ? AND nickname = ?", [boss, userNick], (err) => {
                    if (err) return res.status(500).json({ error: 'DB Error' });
                    res.json({ message: 'Canceled', joined: false });
                });
            } else {
                db.run("INSERT INTO boss_participants (boss, nickname) VALUES (?, ?)", [boss, userNick], (err) => {
                    if (err) return res.status(500).json({ error: 'DB Error' });
                    res.json({ message: 'Joined', joined: true });
                });
            }
        });
    });
});

app.get('/api/participants', verifyToken, (req, res) => {
    db.all("SELECT boss, nickname FROM boss_participants ORDER BY nickname ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        const participantsMap = {};
        rows.forEach(r => {
            if (!participantsMap[r.boss]) participantsMap[r.boss] = [];
            participantsMap[r.boss].push(r.nickname);
        });
        res.json(participantsMap);
    });
});

app.get('/api/participation-targets', verifyToken, (req, res) => {
    db.all("SELECT boss FROM participation_targets", (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        res.json(rows.map(r => r.boss));
    });
});

app.post('/api/participation-targets', verifyToken, (req, res) => {
    const { bosses } = req.body;
    if (!Array.isArray(bosses)) return res.status(400).json({ error: 'Array required.' });

    db.get("SELECT role FROM users WHERE id = ?", [req.userId], (err, row) => {
        if (err || !row || (row.role !== 'MASTER' && row.role !== 'ADMIN')) {
            return res.status(403).json({ error: '운영진 이상만 가능합니다.' });
        }
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("DELETE FROM participation_targets");
            const stmt = db.prepare("INSERT INTO participation_targets (boss) VALUES (?)");
            bosses.forEach(b => stmt.run(b));
            stmt.finalize();
            db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: 'Update failed.' });
                res.json({ success: true });
            });
        });
    });
});

// --- Rerouting for clean URLs ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// ============================================
// Settings Management
// ============================================

app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

app.put('/api/settings', verifyToken, (req, res) => {
    if (req.userRole !== 'MASTER') return res.status(403).json({ error: 'Master only' });
    const { guild_name } = req.body;
    db.run("UPDATE settings SET value = ? WHERE key = 'guild_name'", [guild_name], (err) => {
        if (err) return res.status(500).json({ error: 'Update failed' });
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
