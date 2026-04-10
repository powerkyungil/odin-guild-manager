const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
    db.all("PRAGMA table_info(settings)", (err, columns) => {
        console.log('Columns:', JSON.stringify(columns));
        db.run("UPDATE settings SET guild_name = 'TEST' WHERE rowid = (SELECT rowid FROM settings LIMIT 1)", (err) => {
            if (err) console.error('❌ Update Failed:', err.message);
            else console.log('✅ Update Success');
            process.exit(0);
        });
    });
});
