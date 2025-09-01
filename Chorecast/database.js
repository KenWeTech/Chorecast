const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { DateTime } = require('luxon');

const dbPath = path.join(__dirname, 'data', 'chorecast.db');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    console.log("Creating 'data' directory...");
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Successfully connected to the SQLite database.');
    }
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) {
            console.error("dbGet error:", err.message, "SQL:", sql, "Params:", params);
            reject(err);
        } else {
            resolve(row);
        }
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error("dbAll error:", err.message, "SQL:", sql, "Params:", params);
            reject(err);
        } else {
            resolve(rows);
        }
    });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) {
            console.error("dbRun error:", err.message, "SQL:", sql, "Params:", params);
            reject(err);
        } else {
            resolve(this);
        }
    });
});

async function columnExists(tableName, columnName) {
    try {
        const columns = await dbAll(`PRAGMA table_info(${tableName});`);
        return columns.some(col => col.name === columnName);
    } catch (error) {
        console.error(`Error checking column existence for ${tableName}.${columnName}:`, error.message);
        return false;
    }
}

const initializeDbSchema = async () => {
    console.log("Initializing database schema...");
    try {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                isAdmin INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                nfcTagId TEXT,
                assignedReaderId INTEGER
            );
        `);

        await dbRun(`
            CREATE TABLE IF NOT EXISTS mac_address_bans (
                macAddress TEXT PRIMARY KEY,
                failedAttempts INTEGER DEFAULT 0,
                banCount INTEGER DEFAULT 0,
                lastAttemptTime TEXT,
                banExpiryTime TEXT
            );
        `);

        await dbRun(`
            CREATE TABLE IF NOT EXISTS chores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                area TEXT,
                duration INTEGER,
                nfcTagId TEXT,
                important INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                assignmentType TEXT DEFAULT 'manual',
                lastAssignedUserId INTEGER
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS chore_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                choreId INTEGER NOT NULL,
                scheduleType TEXT NOT NULL,
                specificDate TEXT,
                daysOfWeek TEXT,
                time TEXT,
                assignedUserId INTEGER
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS chore_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                choreId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                UNIQUE(choreId, userId)
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS chore_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                choreId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                assignedDate TEXT NOT NULL,
                completedAt TEXT,
                readerMacAddress TEXT,
                status TEXT DEFAULT 'completed'
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS chorecast_readers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                macAddress TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                isOnline INTEGER DEFAULT 0,
                lastSeen TEXT DEFAULT CURRENT_TIMESTAMP,
                ipAddress TEXT,
                modelNumber TEXT
            );
        `);

        if (!(await columnExists('chorecast_readers', 'modelNumber'))) {
            await dbRun(`ALTER TABLE chorecast_readers ADD COLUMN modelNumber TEXT;`);
            console.log("Migration: Added 'modelNumber' column to 'chorecast_readers' table.");
        }
        await dbRun(`
            CREATE TABLE IF NOT EXISTS reader_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                readerMacAddress TEXT UNIQUE NOT NULL,
                userId INTEGER NOT NULL,
                signedInAt TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS chore_daily_stats (
                statDate TEXT NOT NULL,
                choreId INTEGER NOT NULL,
                userId INTEGER NOT NULL,
                choreName TEXT NOT NULL,
                userName TEXT NOT NULL,
                assignedCount INTEGER DEFAULT 0,
                completedCount INTEGER DEFAULT 0,
                missedCount INTEGER DEFAULT 0,
                completionTimestamp TEXT,
                PRIMARY KEY (statDate, choreId, userId)
            );
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS reminder_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                choreId INTEGER NOT NULL,
                userId INTEGER,
                sentAt TEXT DEFAULT CURRENT_TIMESTAMP,
                sentDate TEXT NOT NULL,
                reminderType TEXT NOT NULL,
                UNIQUE(choreId, sentDate, reminderType)
            );
        `);

        const nfcTagsTableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='nfc_tags';");
        const nfcTagsIdColumnExists = nfcTagsTableExists && await columnExists('nfc_tags', 'id');

        if (nfcTagsTableExists && !nfcTagsIdColumnExists) {
            console.warn("Migration: 'id' column missing from 'nfc_tags' table. Performing data migration...");
            await dbRun('ALTER TABLE nfc_tags RENAME TO old_nfc_tags;');
            console.log("Migration: Renamed 'nfc_tags' to 'old_nfc_tags'.");

            await dbRun(`
                CREATE TABLE nfc_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    tagId TEXT UNIQUE NOT NULL,
                    type TEXT DEFAULT 'chore'
                );
            `);
            console.log("Migration: Created new 'nfc_tags' table with 'id' column.");

            await dbRun(`
                INSERT INTO nfc_tags (name, tagId, type)
                SELECT name, tagId, COALESCE(type, 'chore') FROM old_nfc_tags;
            `);
            console.log("Migration: Copied data to new 'nfc_tags' table.");

            await dbRun('DROP TABLE old_nfc_tags;');
            console.log("Migration: Dropped 'old_nfc_tags' table.");
            console.log("Migration: 'nfc_tags' table successfully migrated with 'id' column.");
        } else if (!nfcTagsTableExists) {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS nfc_tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    tagId TEXT UNIQUE NOT NULL,
                    type TEXT DEFAULT 'chore'
                );
            `);
            console.log("Migration: 'nfc_tags' table created for the first time.");
        }

        if (!(await columnExists('chorecast_readers', 'ipAddress'))) { await dbRun(`ALTER TABLE chorecast_readers ADD COLUMN ipAddress TEXT;`); }
        if (!(await columnExists('chorecast_readers', 'lastSeen'))) { await dbRun(`ALTER TABLE chorecast_readers ADD COLUMN lastSeen TEXT DEFAULT CURRENT_TIMESTAMP;`); }
        if (!(await columnExists('chorecast_readers', 'isOnline'))) { await dbRun(`ALTER TABLE chorecast_readers ADD COLUMN isOnline INTEGER DEFAULT 0;`); }
        if (!(await columnExists('chorecast_readers', 'name'))) { await dbRun(`ALTER TABLE chorecast_readers ADD COLUMN name TEXT;`); }

        if (!(await columnExists('users', 'nfcTagId'))) { await dbRun(`ALTER TABLE users ADD COLUMN nfcTagId TEXT;`); }
        if (!(await columnExists('users', 'assignedReaderId'))) { await dbRun(`ALTER TABLE users ADD COLUMN assignedReaderId INTEGER;`); }
        if (!(await columnExists('users', 'enabled'))) { await dbRun(`ALTER TABLE users ADD COLUMN enabled INTEGER DEFAULT 1;`); }
        if (!(await columnExists('users', 'isAdmin'))) { await dbRun(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0;`); }

        if (!(await columnExists('reminder_log', 'sentDate'))) { await dbRun(`ALTER TABLE reminder_log ADD COLUMN sentDate TEXT;`); }
        if (!(await columnExists('reminder_log', 'userId'))) { await dbRun(`ALTER TABLE reminder_log ADD COLUMN userId INTEGER;`); }
        if (!(await columnExists('reminder_log', 'reminderType'))) { await dbRun(`ALTER TABLE reminder_log ADD COLUMN reminderType TEXT;`); }
        if (!(await columnExists('reminder_log', 'sentAt'))) { await dbRun(`ALTER TABLE reminder_log ADD COLUMN sentAt TEXT DEFAULT CURRENT_TIMESTAMP;`); }

        if (!(await columnExists('reader_sessions', 'signedInAt'))) { await dbRun(`ALTER TABLE reader_sessions ADD COLUMN signedInAt TEXT DEFAULT CURRENT_TIMESTAMP;`); }
        if (!(await columnExists('reader_sessions', 'userId'))) { await dbRun(`ALTER TABLE reader_sessions ADD COLUMN userId INTEGER;`); }
        if (!(await columnExists('reader_sessions', 'readerMacAddress'))) { await dbRun(`ALTER TABLE reader_sessions ADD COLUMN readerMacAddress TEXT;`); }

        if (!(await columnExists('chores', 'assignmentType'))) { await dbRun(`ALTER TABLE chores ADD COLUMN assignmentType TEXT DEFAULT 'manual';`); }
        if (!(await columnExists('chores', 'important'))) { await dbRun(`ALTER TABLE chores ADD COLUMN important INTEGER DEFAULT 0;`); }
        if (!(await columnExists('chores', 'enabled'))) { await dbRun(`ALTER TABLE chores ADD COLUMN enabled INTEGER DEFAULT 1;`); }
        if (!(await columnExists('chores', 'lastAssignedUserId'))) { await dbRun(`ALTER TABLE chores ADD COLUMN lastAssignedUserId INTEGER;`); }
        if (!(await columnExists('chores', 'nfcTagId'))) { await dbRun(`ALTER TABLE chores ADD COLUMN nfcTagId TEXT;`); }
        if (!(await columnExists('chores', 'duration'))) { await dbRun(`ALTER TABLE chores ADD COLUMN duration INTEGER;`); }
        if (!(await columnExists('chores', 'area'))) { await dbRun(`ALTER TABLE chores ADD COLUMN area TEXT;`); }
        if (!(await columnExists('chores', 'description'))) { await dbRun(`ALTER TABLE chores ADD COLUMN description TEXT;`); }
        if (!(await columnExists('chores', 'name'))) { await dbRun(`ALTER TABLE chores ADD COLUMN name TEXT;`); }

        const choreLogTableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='chore_log';");
        const choreLogAssignedDateExists = choreLogTableExists && await columnExists('chore_log', 'assignedDate');
        const choreLogCompletionTimestampExists = choreLogTableExists && await columnExists('chore_log', 'completionTimestamp');
        const choreLogCompletedAtExists = choreLogTableExists && await columnExists('chore_log', 'completedAt');

        if (choreLogTableExists && !choreLogAssignedDateExists) {
            console.warn("Migration: 'assignedDate' column missing from 'chore_log' table. Adding column...");
            await dbRun(`ALTER TABLE chore_log ADD COLUMN assignedDate TEXT;`);
            if (choreLogCompletedAtExists) {
                console.log("Migration: Backfilling 'assignedDate' with date part of 'completedAt' in 'chore_log'.");
                await dbRun(`UPDATE chore_log SET assignedDate = SUBSTR(completedAt, 1, 10) WHERE assignedDate IS NULL;`);
            } else if (choreLogCompletionTimestampExists) {
                console.log("Migration: Backfilling 'assignedDate' with date part of 'completionTimestamp' in 'chore_log'.");
                await dbRun(`UPDATE chore_log SET assignedDate = SUBSTR(completionTimestamp, 1, 10) WHERE assignedDate IS NULL;`);
            }
        }

        if (choreLogTableExists && choreLogCompletionTimestampExists && !choreLogCompletedAtExists) {
            console.warn("Migration: Renaming 'completionTimestamp' to 'completedAt' in 'chore_log'.");
            await dbRun(`ALTER TABLE chore_log RENAME COLUMN completionTimestamp TO completedAt;`);
        }

        if (!(await columnExists('chore_log', 'status'))) { await dbRun(`ALTER TABLE chore_log ADD COLUMN status TEXT DEFAULT 'completed';`); }
        if (!(await columnExists('chore_log', 'readerMacAddress'))) { await dbRun(`ALTER TABLE chore_log ADD COLUMN readerMacAddress TEXT;`); }
        if (!(await columnExists('chore_log', 'userId'))) { await dbRun(`ALTER TABLE chore_log ADD COLUMN userId INTEGER;`); }
        if (!(await columnExists('chore_log', 'choreId'))) { await dbRun(`ALTER TABLE chore_log ADD COLUMN choreId INTEGER;`); }

        const adminUser = await dbGet('SELECT id FROM users WHERE username = ?', ['admin']);
        if (!adminUser) {
            const hashedPassword = await bcrypt.hash('adminpassword', 10);
            await dbRun('INSERT INTO users (username, password, isAdmin, enabled) VALUES (?, ?, 1, 1)', ['admin', hashedPassword]);
            console.log("Default admin user created.");
        }

        const settingsToInsert = {
            authMethod: 'reader_assigned',
            nudgrWebhookUrl: '',
            nudgrApiKey: '',
            nudgrOnMissed: 'false',
            nudgrOnImportant: 'false',
            nudgrAlertLeadTime: '0_minutes',
            nudgrIsRelentless: 'false',
            signOutTagId: '',
            haWebhookUrl: '',
            useMilitaryTime: 'false'
        };

        for (const [key, defaultValue] of Object.entries(settingsToInsert)) {
            const settingExists = await dbGet('SELECT value FROM settings WHERE key = ?', [key]);
            if (!settingExists) {
                await dbRun('INSERT INTO settings (key, value) VALUES (?, ?)', [key, defaultValue]);
            }
        }

        console.log("Database schema initialization complete.");
    } catch (err) {
        console.error("Error initializing database schema:", err.message);
        throw err;
    }
};

module.exports = {
    db,
    dbGet,
    dbAll,
    dbRun,
    initializeDbSchema,
};
