const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');
db.run("UPDATE settings SET guild_name = guild_name WHERE id = 1", (err) => {
    if (err) {
        console.error('❌ Write Test Failed:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Write Test Success: DB is writable');
        process.exit(0);
    }
});
