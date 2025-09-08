require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { DateTime } = require('luxon');
const bonjour = require('bonjour')();

const { db, dbGet, dbAll, dbRun, initializeDbSchema } = require('./database');
const { initializeMqttBroker, aedes, sendWebhook, sendResponse, parseLeadTime, updateDailyChoreStats, determineAssignedUserForPoolChore, getAssignedUserForDay, generateAndSendDailySummaryWebhook } = require('./server_utilities');

const TIMEZONE = process.env.TIMEZONE;
console.log(`Application timezone set to: ${TIMEZONE}`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

initializeDbSchema().catch(err => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
});

initializeMqttBroker(
    parseInt(process.env.MQTT_PORT || 1887),
    parseInt(process.env.MQTT_WS_PORT || 8887)
);

(async () => {
    await generateAndSendDailySummaryWebhook();
})();

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) {
        return sendResponse(res, false, 'Access Denied: No token provided.', null, 401);
    }

    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not defined. Cannot verify token.");
        return sendResponse(res, false, 'Server configuration error: JWT secret missing.', null, 500);
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.warn("JWT verification failed:", err.message);
            return sendResponse(res, false, 'Authentication failed: Invalid or expired token.', null, 403);
        }
        req.user = user; 
        next();
    });
};

const adminOnly = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        sendResponse(res, false, 'Access Denied: Admin privileges required.', null, 403);
    }
};

app.use('/api', (req, res, next) => {
    if (req.path === '/login' || req.path === '/config' || req.path === '/complete-chore') { 
        return next();
    }
    verifyToken(req, res, next);
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ? AND enabled = 1', [username]);
        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign(
                { id: user.id, username: user.username, isAdmin: user.isAdmin },
                process.env.JWT_SECRET,
                { expiresIn: '8h' } 
            );
            sendResponse(res, true, 'Login successful', { id: user.id, username: user.username, isAdmin: user.isAdmin, token });
        } else {
            sendResponse(res, false, 'Invalid username or password, or user is disabled.', null, 401);
        }
    } catch (err) {
        console.error("Login error:", err.message);
        sendResponse(res, false, 'Server error during login.', null, 500);
    }
});

app.get('/api/config', async (req, res) => { 
    try {
        
        const settingsRows = await dbAll('SELECT key, value FROM settings');
        const settings = settingsRows.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});

        const config = {
            mqttWsPort: process.env.MQTT_WS_PORT || 8887, 
            authMethod: settings.authMethod || 'reader_assigned', 
            timezone: TIMEZONE, 
            
        };
        sendResponse(res, true, 'Configuration retrieved successfully.', config);
    } catch (err) {
        console.error("Error retrieving configuration:", err.message);
        sendResponse(res, false, 'Failed to retrieve configuration.', null, 500);
    }
});

app.get('/api/users', async (req, res) => {
    if (!req.user.isAdmin) {
        return sendResponse(res, false, 'Access denied. Admin privileges required.', null, 403);
    }
    try {
        const users = await dbAll('SELECT id, username, isAdmin, enabled, nfcTagId, assignedReaderId FROM users');
        sendResponse(res, true, 'Users fetched successfully', users);
    } catch (err) {
        console.error("Error fetching users:", err.message);
        sendResponse(res, false, 'Failed to fetch users.', null, 500);
    }
});

app.post('/api/users', adminOnly, async (req, res) => {
    const { username, password, isAdmin, enabled, nfcTagId, assignedReaderId } = req.body;
    if (!username || !password) {
        return sendResponse(res, false, 'Username and password are required.', null, 400);
    }
    try {
        let actualTagId = null;
        if (nfcTagId) { 
            const tag = await dbGet('SELECT tagId FROM nfc_tags WHERE id = ?', [nfcTagId]);
            if (tag) {
                actualTagId = tag.tagId;
            } else {
                console.warn(`Attempted to assign non-existent NFC Tag with ID ${nfcTagId} to new user ${username}.`);
            }
        }
		
		const hashedPassword = await bcrypt.hash(password, 10);
        const result = await dbRun(
            'INSERT INTO users (username, password, isAdmin, enabled, nfcTagId, assignedReaderId) VALUES (?, ?, ?, ?, ?, ?)',
            [username, hashedPassword, isAdmin ? 1 : 0, enabled ? 1 : 0, actualTagId, assignedReaderId || null]
        );
        sendResponse(res, true, 'User created successfully', { id: result.lastID });
    } catch (err) {
        console.error("Error creating user:", err.message);
        if (err.message.includes('UNIQUE constraint failed: users.username')) {
            return sendResponse(res, false, 'Username already exists.', null, 409);
        }
        sendResponse(res, false, 'Failed to create user.', null, 500);
    }
});

app.put('/api/users/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    const { username, password, isAdmin, enabled, nfcTagId, assignedReaderId } = req.body;
    if (!username) {
        return sendResponse(res, false, 'Username is required.', null, 400);
    }

    try {
        let actualTagId = null;
        if (nfcTagId) { 
            const tag = await dbGet('SELECT tagId FROM nfc_tags WHERE id = ?', [nfcTagId]);
            if (tag) {
                actualTagId = tag.tagId;
            } else {
                console.warn(`Attempted to assign non-existent NFC Tag with ID ${nfcTagId} to user ID ${id}.`);
            }
        }

        const enabledValue = enabled ? 1 : 0;

        let sql;
        let params;

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            sql = 'UPDATE users SET username = ?, password = ?, isAdmin = ?, enabled = ?, nfcTagId = ?, assignedReaderId = ? WHERE id = ?';
            params = [username, hashedPassword, (isAdmin ? 1 : 0), enabledValue, actualTagId, assignedReaderId || null, id];
        } else {
            sql = 'UPDATE users SET username = ?, isAdmin = ?, enabled = ?, nfcTagId = ?, assignedReaderId = ? WHERE id = ?';
            params = [username, (isAdmin ? 1 : 0), enabledValue, actualTagId, assignedReaderId || null, id];
        }

        const result = await dbRun(sql, params);
        if (result.changes > 0) {
            sendResponse(res, true, 'User updated successfully');
        } else {
            sendResponse(res, false, 'User not found or no changes made.', null, 404);
        }
    } catch (err) {
        console.error("Error updating user:", err.message);
        if (err.message.includes('UNIQUE constraint failed: users.username')) {
            return sendResponse(res, false, 'Username already exists.', null, 409);
        }
        sendResponse(res, false, 'Failed to update user.', null, 500);
    }
});

app.delete('/api/users/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await dbRun('DELETE FROM users WHERE id = ?', [id]);
        if (result.changes > 0) {
            sendResponse(res, true, 'User deleted successfully');
        } else {
            sendResponse(res, false, 'User not found.', null, 404);
        }
    } catch (err) {
        console.error("Error deleting user:", err.message);
        sendResponse(res, false, 'Failed to delete user.', null, 500);
    }
});

app.get('/api/chores', async (req, res) => {
    try {
        const chores = await dbAll('SELECT c.id, c.name, c.description, c.area, c.duration, c.nfcTagId, c.important, c.enabled, c.assignmentType FROM chores c');

        for (let chore of chores) {
            chore.schedules = await dbAll('SELECT scheduleType, specificDate, daysOfWeek, time, assignedUserId FROM chore_schedules WHERE choreId = ?', [chore.id]);

            if (chore.assignmentType !== 'manual') {
                const assignedUsers = await dbAll('SELECT u.id, u.username FROM chore_assignments ca JOIN users u ON ca.userId = u.id WHERE ca.choreId = ?', [chore.id]);
                chore.assignedUsers = assignedUsers;
                chore.assignedUsernames = assignedUsers.map(u => u.username).join(', ');
            } else {
                
                const assignedUserIds = chore.schedules
                    .filter(s => s.assignedUserId)
                    .map(s => s.assignedUserId);
                
                if (assignedUserIds.length > 0) {
                    const uniqueUserIds = [...new Set(assignedUserIds)];
                    const users = await dbAll(`SELECT username FROM users WHERE id IN (${uniqueUserIds.map(() => '?').join(',')})`, uniqueUserIds);
                    chore.assignedUsernames = users.map(u => u.username).join(', ');
                } else {
                    chore.assignedUsernames = 'N/A';
                }
            }
        }
        sendResponse(res, true, 'Chores retrieved successfully.', chores);
    } catch (err) {
        console.error("Error retrieving chores:", err.message);
        sendResponse(res, false, 'Failed to retrieve chores.', null, 500);
    }
});

app.get('/api/chores/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const chore = await dbGet('SELECT c.id, c.name, c.description, c.area, c.duration, c.nfcTagId, c.important, c.enabled, c.assignmentType FROM chores c WHERE c.id = ?', [id]);
        if (!chore) {
            return sendResponse(res, false, 'Chore not found.', null, 404);
        }
        chore.schedules = await dbAll('SELECT scheduleType, specificDate, daysOfWeek, time, assignedUserId FROM chore_schedules WHERE choreId = ?', [chore.id]);
        
        if (chore.assignmentType !== 'manual') {
            chore.assignedUsers = await dbAll('SELECT u.id, u.username FROM chore_assignments ca JOIN users u ON ca.userId = u.id WHERE ca.choreId = ?', [chore.id]);
        }
        sendResponse(res, true, 'Chore retrieved successfully.', chore);
    } catch (err) {
        console.error("Error retrieving chore details:", err.message);
        sendResponse(res, false, 'Failed to retrieve chore details.', null, 500);
    }
});

app.post('/api/chores', adminOnly, async (req, res) => {
    const { name, description, area, duration, nfcTagId, important, enabled, assignmentType, schedules, assignedUsers } = req.body;
    if (!name) {
        return sendResponse(res, false, 'Chore name is required.', null, 400);
    }
    try {
        let actualTagId = null;
        if (nfcTagId) {
            const tag = await dbGet('SELECT tagId FROM nfc_tags WHERE id = ?', [nfcTagId]);
            if (tag) actualTagId = tag.tagId;
        }
        
        const result = await dbRun('INSERT INTO chores (name, description, area, duration, nfcTagId, important, enabled, assignmentType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description, area, duration, actualTagId, important ? 1 : 0, enabled ? 1 : 0, assignmentType]);
        const choreId = result.lastID;

        if (schedules && schedules.length > 0) {
            for (const schedule of schedules) {
                await dbRun('INSERT INTO chore_schedules (choreId, scheduleType, specificDate, daysOfWeek, time, assignedUserId) VALUES (?, ?, ?, ?, ?, ?)',
                    [choreId, schedule.scheduleType, schedule.specificDate, schedule.daysOfWeek, schedule.time, schedule.assignedUserId]);
            }
        }

        if (assignmentType !== 'manual' && assignedUsers && assignedUsers.length > 0) {
            for (const userId of assignedUsers) {
                await dbRun('INSERT INTO chore_assignments (choreId, userId) VALUES (?, ?)', [choreId, userId]);
            }
        }

        const today = DateTime.now().setZone(TIMEZONE).toISODate();
        const currentDayOfWeek = DateTime.now().setZone(TIMEZONE).weekday % 7;

        const isDueToday = schedules.some(s => 
            (s.scheduleType === 'daily') ||
            (s.scheduleType === 'once' && s.specificDate === today) || 
            (s.scheduleType === 'weekly' && s.daysOfWeek && s.daysOfWeek.split(',').map(Number).includes(currentDayOfWeek))
        );

        if (isDueToday) {
            let userIdsToAssign = [];
            if (assignmentType === 'manual') {
                userIdsToAssign = schedules
                    .filter(s => s.assignedUserId && ((s.scheduleType === 'daily') || (s.scheduleType === 'once' && s.specificDate === today) || (s.scheduleType === 'weekly' && s.daysOfWeek.split(',').map(Number).includes(currentDayOfWeek))))
                    .map(s => s.assignedUserId);
            } else {
                const singleUserId = await determineAssignedUserForPoolChore(choreId, assignmentType);
                if (singleUserId) userIdsToAssign.push(singleUserId);
            }

            for (const userId of [...new Set(userIdsToAssign)]) {
                const user = await dbGet('SELECT username FROM users WHERE id = ?', [userId]);
                if (user) {
                    await updateDailyChoreStats(today, choreId, userId, name, user.username, 'assigned', 1);
                }
            }
        }

        sendResponse(res, true, 'Chore created successfully.', { id: choreId });
    } catch (err) {
        console.error("Error creating chore:", err.message);
        sendResponse(res, false, 'Failed to create chore.', null, 500);
    }
});

app.put('/api/chores/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    const { name, description, area, duration, nfcTagId, important, enabled, assignmentType, schedules, assignedUsers } = req.body;
    if (!name) {
        return sendResponse(res, false, 'Chore name is required.', null, 400);
    }

    try {
        let actualTagId = null;
        if (nfcTagId) {
            const tag = await dbGet('SELECT tagId FROM nfc_tags WHERE id = ?', [nfcTagId]);
            if (tag) actualTagId = tag.tagId;
        }

        const result = await dbRun('UPDATE chores SET name = ?, description = ?, area = ?, duration = ?, nfcTagId = ?, important = ?, enabled = ?, assignmentType = ? WHERE id = ?',
            [name, description, area, duration, actualTagId, important ? 1 : 0, enabled ? 1 : 0, assignmentType, id]);

        if (result.changes === 0) {
            return sendResponse(res, false, 'Chore not found or no changes made.', null, 404);
        }

        await dbRun('DELETE FROM chore_schedules WHERE choreId = ?', [id]);
        if (schedules && schedules.length > 0) {
            for (const schedule of schedules) {
                await dbRun('INSERT INTO chore_schedules (choreId, scheduleType, specificDate, daysOfWeek, time, assignedUserId) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, schedule.scheduleType, schedule.specificDate, schedule.daysOfWeek, schedule.time, schedule.assignedUserId]);
            }
        }

        await dbRun('DELETE FROM chore_assignments WHERE choreId = ?', [id]);
        if (assignmentType !== 'manual' && assignedUsers && assignedUsers.length > 0) {
            for (const userId of assignedUsers) {
                await dbRun('INSERT INTO chore_assignments (choreId, userId) VALUES (?, ?)', [id, userId]);
            }
        }

        const today = DateTime.now().setZone(TIMEZONE).toISODate();
        const currentDayOfWeek = DateTime.now().setZone(TIMEZONE).weekday % 7;
        const choreIdInt = parseInt(id);

        const previousAssignments = await dbAll('SELECT userId FROM chore_daily_stats WHERE choreId = ? AND statDate = ? AND assignedCount > 0', [choreIdInt, today]);
        for (const assignment of previousAssignments) {
            await dbRun('UPDATE chore_daily_stats SET assignedCount = 0 WHERE choreId = ? AND userId = ? AND statDate = ?', [choreIdInt, assignment.userId, today]);
        }

        const isDueToday = schedules.some(s => 
            (s.scheduleType === 'daily') ||
            (s.scheduleType === 'once' && s.specificDate === today) || 
            (s.scheduleType === 'weekly' && s.daysOfWeek && s.daysOfWeek.split(',').map(Number).includes(currentDayOfWeek))
        );

        if (isDueToday) {
            let userIdsToAssign = [];
            if (assignmentType === 'manual') {
                userIdsToAssign = schedules
                    .filter(s => s.assignedUserId && ((s.scheduleType === 'daily') || (s.scheduleType === 'once' && s.specificDate === today) || (s.scheduleType === 'weekly' && s.daysOfWeek.split(',').map(Number).includes(currentDayOfWeek))))
                    .map(s => s.assignedUserId);
            } else {
                const singleUserId = await determineAssignedUserForPoolChore(choreIdInt, assignmentType);
                if (singleUserId) userIdsToAssign.push(singleUserId);
            }

            for (const userId of [...new Set(userIdsToAssign)]) {
                const user = await dbGet('SELECT username FROM users WHERE id = ?', [userId]);
                if (user) {
                    await updateDailyChoreStats(today, choreIdInt, userId, name, user.username, 'assigned', 1);
                }
            }
        }
        
        sendResponse(res, true, 'Chore updated successfully.');
    } catch (err) {
        console.error("Error updating chore:", err.message);
        sendResponse(res, false, 'Failed to update chore.', null, 500);
    }
});

app.delete('/api/chores/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    try {
        
        await dbRun('DELETE FROM chore_schedules WHERE choreId = ?', [id]);
        await dbRun('DELETE FROM chore_assignments WHERE choreId = ?', [id]);
        await dbRun('DELETE FROM chore_log WHERE choreId = ?', [id]); 
        
        await dbRun('DELETE FROM chore_daily_stats WHERE choreId = ?', [id]);

        const result = await dbRun('DELETE FROM chores WHERE id = ?', [id]);
        if (result.changes > 0) {
            sendResponse(res, true, 'Chore and associated data deleted successfully.');
        } else {
            sendResponse(res, false, 'Chore not found.', null, 404);
        }
    } catch (err) {
        console.error("Error deleting chore:", err.message);
        sendResponse(res, false, 'Failed to delete chore.', null, 500);
    }
});

app.get('/api/tags', async (req, res) => {
    try {
        const tags = await dbAll('SELECT id, name, tagId, type FROM nfc_tags'); 
        sendResponse(res, true, 'NFC tags retrieved successfully.', tags);
    }
    catch (err) {
        console.error("Error retrieving NFC tags:", err.message);
        sendResponse(res, false, 'Failed to retrieve NFC tags.', null, 500);
    }
});

app.post('/api/tags', adminOnly, async (req, res) => {
    const { nfcTagId, name, type } = req.body; 
    if (!nfcTagId || !name || !type) {
        return sendResponse(res, false, 'Tag ID, name, and type are required.', null, 400);
    }
    try {
        const result = await dbRun('INSERT INTO nfc_tags (tagId, name, type) VALUES (?, ?, ?)', [nfcTagId, name, type]);
        sendResponse(res, true, 'NFC tag created successfully.', { id: result.lastID });
    } catch (err) {
        if (err.message.includes('SQLITE_CONSTRAINT: UNIQUE')) {
            return sendResponse(res, false, 'NFC Tag ID already exists.', null, 409);
        }
        console.error("Error creating NFC tag:", err.message);
        sendResponse(res, false, 'Failed to create NFC tag.', null, 500);
    }
});

app.put('/api/tags/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    const { nfcTagId, name, type } = req.body;
    
    if (!nfcTagId || !name || !type) {
        return sendResponse(res, false, 'Tag ID, name, and type are required for update.', null, 400);
    }
    try {
        const existingTag = await dbGet('SELECT id FROM nfc_tags WHERE tagId = ? AND id != ?', [nfcTagId, id]);
        if (existingTag) {
            return sendResponse(res, false, 'NFC Tag ID already exists for another tag.', null, 409);
        }

        const result = await dbRun('UPDATE nfc_tags SET tagId = ?, name = ?, type = ? WHERE id = ?', [nfcTagId, name, type, id]);
        if (result.changes > 0) {
            sendResponse(res, true, 'NFC tag updated successfully.');
        } else {
            sendResponse(res, false, 'NFC tag not found or no changes made.', null, 404);
        }
    } catch (err) {
        console.error("Error updating NFC tag:", err.message);
        sendResponse(res, false, 'Failed to update NFC tag.', null, 500);
    }
});

app.delete('/api/tags/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await dbRun('DELETE FROM nfc_tags WHERE id = ?', [id]);
        if (result.changes > 0) {
            sendResponse(res, true, 'NFC tag deleted successfully.');
        } else {
            sendResponse(res, false, 'NFC tag not found.', null, 404);
        }
    } catch (err) {
        console.error("Error deleting NFC tag:", err.message);
        sendResponse(res, false, 'Failed to delete NFC tag.', null, 500);
    }
});

app.get('/api/readers', async (req, res) => {
    try {
        const readers = await dbAll('SELECT id, macAddress, name, friendly_name, ipAddress, isOnline, lastSeen, modelNumber FROM chorecast_readers');
        sendResponse(res, true, 'NFC readers retrieved successfully.', readers);
    } catch (err) {
        console.error("Error retrieving NFC readers:", err.message);
        sendResponse(res, false, 'Failed to retrieve NFC readers.', null, 500);
    }
});

app.put('/api/readers/:macAddress/name', adminOnly, async (req, res) => {
    const { macAddress } = req.params;
    const { friendly_name } = req.body;
    if (friendly_name === undefined) { 
        return sendResponse(res, false, 'Friendly name is required.', null, 400);
    }
    try {
        let sql = 'UPDATE chorecast_readers SET friendly_name = ? WHERE macAddress = ?';
        let params = [friendly_name, macAddress];
        if (friendly_name === "") {
            sql = 'UPDATE chorecast_readers SET friendly_name = NULL WHERE macAddress = ?';
            params = [macAddress];
        }

        const result = await dbRun(sql, params);
        if (result.changes > 0) {
            sendResponse(res, true, 'Reader name updated successfully.');
        } else {
            sendResponse(res, false, 'Reader not found or no changes made.', null, 404);
        }
    } catch (err) {
        console.error("Error updating reader name:", err.message);
        sendResponse(res, false, 'Failed to update reader name.', null, 500);
    }
});

app.delete('/api/readers/:id', adminOnly, async (req, res) => {
    const { id } = req.params;
    try {
        
        const reader = await dbGet('SELECT macAddress, isOnline FROM chorecast_readers WHERE id = ?', [id]);

        if (!reader) {
            return sendResponse(res, false, 'NFC reader not found.', null, 404);
        }

        if (reader.isOnline) {
            const topic = `chorecast/reader/${reader.macAddress}/command`;
            const payload = JSON.stringify({ command: 'factory_reset' });

            aedes.publish({ topic, payload, qos: 1, retain: false }, (err) => {
                if (err) {
                    console.error(`[MQTT Error] Failed to send factory_reset command to ${reader.macAddress}:`, err);
                } else {
                    console.log(`Sent factory reset command to online reader: ${reader.macAddress}`);
                }
            });
        }

        await dbRun('DELETE FROM reader_sessions WHERE readerMacAddress = ?', [reader.macAddress]);
        const result = await dbRun('DELETE FROM chorecast_readers WHERE id = ?', [id]);

        if (result.changes > 0) {
            sendResponse(res, true, 'NFC reader deleted successfully. If it was online, a factory reset command was sent.');
        } else {
            
            sendResponse(res, false, 'NFC reader not found.', null, 404);
        }
    }
    catch (err) {
        console.error("Error deleting NFC reader:", err.message);
        sendResponse(res, false, 'Failed to delete NFC reader.', null, 500);
    }
});

app.get('/api/user/reader-status', async (req, res) => {
    const userId = req.user.id; 
    try {
        
        let reader = await dbGet('SELECT r.name, r.macAddress, r.isOnline, r.friendly_name FROM chorecast_readers r JOIN users u ON r.id = u.assignedReaderId WHERE u.id = ?', [userId]);

        if (!reader) {
            const session = await dbGet('SELECT userId, readerMacAddress FROM reader_sessions WHERE userId = ?', [userId]);
            if (session) {
                
                const sessionReader = await dbGet('SELECT name, isOnline, friendly_name FROM chorecast_readers WHERE macAddress = ?', [session.readerMacAddress]);
                if (sessionReader) {
                    reader = {
                        name: sessionReader.name,
                        macAddress: session.readerMacAddress,
                        isOnline: sessionReader.isOnline
                    };
                }
            }
        }

        if (reader) {
            sendResponse(res, true, 'Reader status retrieved.', {
                readerName: reader.friendly_name || reader.name || `Reader ${reader.macAddress.slice(-6)}`,
                isOnline: reader.isOnline === 1 
            });
        } else {
            sendResponse(res, true, 'No reader connected or assigned to user.', { readerName: null, isOnline: false });
        }
    } catch (err) {
        console.error("Error fetching user reader status:", err.message);
        sendResponse(res, false, 'Failed to retrieve user reader status.', null, 500);
    }
});

app.get('/api/dashboard/today/:userId', async (req, res) => {
    const { userId } = req.params;
    const viewMode = req.query.viewMode || 'my_chores';
    const isAdmin = req.user && req.user.isAdmin;

    if (parseInt(userId) !== req.user.id && !isAdmin) {
        return sendResponse(res, false, 'Access Denied: You can only view your own dashboard data.', null, 403);
    }

    try {
        const today = DateTime.now().setZone(TIMEZONE).toISODate();
        const currentDayOfWeek = DateTime.now().setZone(TIMEZONE).weekday % 7;

        const scheduledChores = await dbAll(`
            SELECT DISTINCT
                c.id, c.name, c.description, c.area, c.duration, c.assignmentType, cs.time
            FROM chores c
            JOIN chore_schedules cs ON c.id = cs.choreId
            WHERE c.enabled = 1 AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
        `, [today, currentDayOfWeek.toString()]);

        let allDueChores = [];

        for (const chore of scheduledChores) {
            let assignedUserIds = [];

            if (chore.assignmentType === 'manual') {
                const manualSchedules = await dbAll(
                    `SELECT assignedUserId FROM chore_schedules WHERE choreId = ? AND assignedUserId IS NOT NULL AND (
                        (scheduleType = 'daily') OR (scheduleType = 'once' AND specificDate = ?) OR (scheduleType = 'weekly' AND INSTR(daysOfWeek, ?) > 0)
                    )`, [chore.id, today, currentDayOfWeek.toString()]
                );
                assignedUserIds = manualSchedules.map(s => s.assignedUserId);
            } else { 
                const assignedUserId = await getAssignedUserForDay(chore.id, chore.assignmentType, today);
                if (assignedUserId) {
                    assignedUserIds.push(assignedUserId);
                }
            }
            
            for (const assignedId of [...new Set(assignedUserIds)].filter(id => id != null)) {
                const user = await dbGet('SELECT id, username FROM users WHERE id = ?', [assignedId]);
                if (user) {
                    allDueChores.push({ ...chore, choreId: chore.id, choreName: chore.name, userId: user.id, userName: user.username });
                }
            }
        }

        let visibleDueChores;
        if (viewMode === 'my_chores') {
            
            visibleDueChores = allDueChores.filter(chore => chore.userId === parseInt(userId));
        } else if (viewMode === 'all_chores' && isAdmin) {
            
            visibleDueChores = allDueChores;
        } else {
            
            visibleDueChores = allDueChores.filter(chore => chore.userId === parseInt(userId));
        }

        const completedChoresLog = await dbAll('SELECT choreId, userId FROM chore_log WHERE assignedDate = ? AND completedAt IS NOT NULL', [today]);
        const dueChoresToday = visibleDueChores.filter(due => 
            !completedChoresLog.some(comp => comp.choreId === due.choreId && comp.userId === due.userId)
        );

        let completedChoresQuery = `
            SELECT cl.choreId, c.name as choreName, c.area, c.duration, u.username as userName, cl.completedAt
            FROM chore_log cl
            JOIN chores c ON cl.choreId = c.id
            JOIN users u ON cl.userId = u.id
            WHERE cl.assignedDate = ?
        `;
        const completedChoresParams = [today];

        if (viewMode === 'my_chores' || !isAdmin) {
            completedChoresQuery += ' AND cl.userId = ?';
            completedChoresParams.push(userId);
        }
        
        const completedChoresToday = await dbAll(completedChoresQuery, completedChoresParams);

        sendResponse(res, true, 'Dashboard data retrieved successfully.', {
            dueChoresToday: dueChoresToday,
            completedChoresToday: completedChoresToday
        });
    } catch (err) {
        console.error("[Dashboard API Error] Error retrieving dashboard data:", err.message);
        sendResponse(res, false, 'Failed to retrieve dashboard data.', null, 500);
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const settingsRows = await dbAll('SELECT key, value FROM settings');
        const settings = settingsRows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        sendResponse(res, true, 'Settings retrieved successfully.', settings);
    }
    catch (err) {
        console.error("Error retrieving settings:", err.message);
        sendResponse(res, false, 'Failed to retrieve settings.', null, 500);
    }
});

app.post('/api/settings', adminOnly, async (req, res) => {
    const newSettings = req.body;
    try {
        const oldAuthMethodSetting = await dbGet("SELECT value FROM settings WHERE key = 'authMethod'");
        const oldAuthMethod = oldAuthMethodSetting ? oldAuthMethodSetting.value : 'reader_assigned';
        const newAuthMethod = newSettings.authMethod;

        for (const key in newSettings) {
            await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, newSettings[key].toString()]);
        }

        if (newAuthMethod && newAuthMethod !== oldAuthMethod) {
            console.log(`Auth method changed from '${oldAuthMethod}' to '${newAuthMethod}'. Cleaning up old state...`);
            if (newAuthMethod === 'user_tag_signin') {
                
                await dbRun('UPDATE users SET assignedReaderId = NULL');
            } else if (newAuthMethod === 'reader_assigned') {
                
                await dbRun('DELETE FROM reader_sessions');
            }
        }
        
        sendResponse(res, true, 'Settings saved successfully.');
    } catch (err) {
        console.error("Error saving settings:", err.message);
        sendResponse(res, false, 'Failed to save settings.', null, 500);
    }
});

app.delete('/api/mac-address-bans', verifyToken, adminOnly, async (req, res) => {
    try {
        await dbRun('DELETE FROM mac_address_bans');
        sendResponse(res, true, 'MAC address bans cleared successfully.');
    } catch (err) {
        console.error("Failed to clear MAC address bans:", err.message);
        sendResponse(res, false, 'Failed to clear MAC address bans.', null, 500);
    }
});

app.get('/api/stats/summary', async (req, res) => {
    const { period, userId } = req.query; 
    let startDateLuxon;
    const now = DateTime.now().setZone(TIMEZONE);

    switch (period) {
        case 'today':
            startDateLuxon = now.startOf('day');
            break;
        case 'yesterday':
            startDateLuxon = now.minus({ days: 1 }).startOf('day');
            break;
        case 'last_7_days':
            startDateLuxon = now.minus({ days: 6 }).startOf('day'); 
            break;
        case 'last_30_days':
            startDateLuxon = now.minus({ days: 29 }).startOf('day'); 
            break;
        case 'all_time':
        default:
            
            const earliestStat = await dbGet('SELECT MIN(statDate) AS minDate FROM chore_daily_stats');
            startDateLuxon = earliestStat && earliestStat.minDate ? DateTime.fromISO(earliestStat.minDate, { zone: TIMEZONE }).startOf('day') : now.startOf('day');
            break;
    }

    const startDateStr = startDateLuxon.toISODate();
    const endDateStr = now.toISODate(); 

    try {
        let query = `
            SELECT
                cds.statDate,
                cds.choreId,
                cds.userId,
                COALESCE(cds.choreName, c.name) AS choreName,
                COALESCE(cds.userName, u.username) AS userName,
                SUM(cds.assignedCount) AS assigned,
                SUM(cds.completedCount) AS completed,
                SUM(cds.missedCount) AS missed
            FROM chore_daily_stats cds
            LEFT JOIN chores c ON cds.choreId = c.id
            LEFT JOIN users u ON cds.userId = u.id
            WHERE cds.statDate BETWEEN ? AND ?
        `;
        const params = [startDateStr, endDateStr];

        if (userId) {
            query += ` AND cds.userId = ?`;
            params.push(userId);
        }

        query += ` GROUP BY cds.statDate, cds.choreId, cds.userId
                   ORDER BY cds.statDate ASC, userName ASC, choreName ASC`;

        const stats = await dbAll(query, params);

        sendResponse(res, true, 'Statistics retrieved successfully.', stats);
    } catch (err) {
        console.error("Error retrieving statistics:", err.message);
        sendResponse(res, false, `Failed to retrieve statistics: ${err.message}`, null, 500);
    }
});

app.delete('/api/stats/clear', verifyToken, adminOnly, async (req, res) => {
    const { userId, period } = req.body;

    try {
        const now = DateTime.now().setZone(TIMEZONE);
        let sql;
        let params = [];

        const executeDeletion = async (query, queryParams) => {
            let changes = 0;
            changes += (await dbRun(query.replace('__TABLE__', 'chore_daily_stats').replace('__DATE_COLUMN__', 'statDate'), queryParams)).changes;
            changes += (await dbRun(query.replace('__TABLE__', 'chore_log').replace('__DATE_COLUMN__', 'assignedDate'), queryParams)).changes;
            changes += (await dbRun(query.replace('__TABLE__', 'reminder_log').replace('__DATE_COLUMN__', 'sentDate'), queryParams)).changes;
            return changes;
        };

        switch (period) {
            case 'all':

                const today = now.startOf('day').toISODate();
                sql = `DELETE FROM __TABLE__ WHERE __DATE_COLUMN__ < ?`;
                params.push(today);
                break;
            
            case 'older_than_7_days':
                const sevenDaysAgo = now.minus({ days: 7 }).startOf('day').toISODate();
                sql = `DELETE FROM __TABLE__ WHERE __DATE_COLUMN__ < ?`;
                params.push(sevenDaysAgo);
                break;

            case 'older_than_30_days':
                const thirtyDaysAgo = now.minus({ days: 30 }).startOf('day').toISODate();
                sql = `DELETE FROM __TABLE__ WHERE __DATE_COLUMN__ < ?`;
                params.push(thirtyDaysAgo);
                break;

            case 'older_than_90_days':
                const ninetyDaysAgo = now.minus({ days: 90 }).startOf('day').toISODate();
                sql = `DELETE FROM __TABLE__ WHERE __DATE_COLUMN__ < ?`;
                params.push(ninetyDaysAgo);
                break;

            default:
                return sendResponse(res, false, 'Invalid time period specified.', null, 400);
        }

        if (userId && userId !== 'all') {
            sql += ' AND userId = ?';
            params.push(parseInt(userId));
        }

        const totalChanges = await executeDeletion(sql, params);
        
        console.log(`Cleared ${totalChanges} historical entries across tables.`);
        sendResponse(res, true, `Successfully cleared ${totalChanges} historical entries.`);

    } catch (err) {
        console.error("Error clearing statistics:", err.message);
        sendResponse(res, false, 'Failed to clear statistics.', null, 500);
    }
});

cron.schedule('0 0 * * *', async () => { 
    const today = DateTime.now().setZone(TIMEZONE).toISODate();
    const currentDayOfWeek = DateTime.now().setZone(TIMEZONE).weekday % 7;

    try {
        
        const choresDueToday = await dbAll(`
            SELECT DISTINCT c.id, c.name, c.assignmentType
            FROM chores c
            JOIN chore_schedules cs ON c.id = cs.choreId
            WHERE c.enabled = 1
            AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
        `, [today, currentDayOfWeek.toString()]);

        let assignmentsMade = 0;

        for (const chore of choresDueToday) {
            let userIdsToAssign = [];

            if (chore.assignmentType === 'manual') {
                
                const manualAssignments = await dbAll(`
                    SELECT DISTINCT assignedUserId FROM chore_schedules
                    WHERE choreId = ? AND assignedUserId IS NOT NULL AND (
                        (scheduleType = 'daily') OR
                        (scheduleType = 'once' AND specificDate = ?) OR
                        (scheduleType = 'weekly' AND INSTR(daysOfWeek, ?) > 0)
                    )
                `, [chore.id, today, currentDayOfWeek.toString()]);
                userIdsToAssign = manualAssignments.map(a => a.assignedUserId);

            } else { 
                
                const singleUserId = await determineAssignedUserForPoolChore(chore.id, chore.assignmentType);
                if (singleUserId) {
                    userIdsToAssign.push(singleUserId);
                }
            }

            for (const userId of userIdsToAssign) {
                const user = await dbGet('SELECT username FROM users WHERE id = ?', [userId]);
                if (user) {
                    await updateDailyChoreStats(today, chore.id, userId, chore.name, user.username, 'assigned', 1);
                    assignmentsMade++;
                }
            }
        }
        console.log(`Daily chore assignment logging complete for ${today}. Processed ${assignmentsMade} assignments.`);

    } catch (err) {
        console.error("Error in daily chore assignment logging cron job:", err.message);
    }
}, {
    timezone: TIMEZONE 
});

cron.schedule('5 0 * * *', async () => { 
    try {

        const todayFormatted = DateTime.now().setZone(TIMEZONE).toISODate();

        const choresToMarkMissed = await dbAll(`
            SELECT cds.statDate, cds.choreId, cds.userId, cds.choreName, cds.userName
            FROM chore_daily_stats cds
            WHERE cds.statDate < ? AND cds.assignedCount > 0 AND cds.completedCount = 0 AND cds.missedCount = 0
        `, [todayFormatted]);

        for (const chore of choresToMarkMissed) {
            await updateDailyChoreStats(chore.statDate, chore.choreId, chore.userId, chore.choreName, chore.userName, 'missed', 1);
        }

        await generateAndSendDailySummaryWebhook();

    } catch (err) {
        console.error("Error in marking missed chores cron job:", err.message);
    }
}, {
    timezone: TIMEZONE
});

cron.schedule('*/15 * * * *', async () => { 
    try {
        const settingsRows = await dbAll('SELECT key, value FROM settings');
        
        const nudgrSettings = settingsRows.reduce((acc, s) => ({ ...acc, [s.key] : s.value }), {});

        const nudgrOnMissed = nudgrSettings.nudgrOnMissed === 'true';
        const nudgrWebhookUrl = nudgrSettings.nudgrWebhookUrl;
        const nudgrApiKey = nudgrSettings.nudgrApiKey;
        const nudgrIsRelentless = nudgrSettings.nudgrIsRelentless === 'true'; 
        const nudgrAlertLeadTimeStr = nudgrSettings.nudgrAlertLeadTime; 

        if (!nudgrOnMissed || !nudgrWebhookUrl || !nudgrApiKey) {
            console.log('Nudgr immediate missed chore reminders are disabled or not configured.');
            return;
        }

        const now = DateTime.now().setZone(TIMEZONE);
        const todayDate = now.toISODate();
        const currentDayOfWeek = now.weekday % 7;

        const potentialMissedChores = await dbAll(`
            SELECT 
                cds.choreId, cds.userId, cds.choreName, cds.userName, cs.time as choreDueTime
            FROM chore_daily_stats cds
            JOIN chore_schedules cs ON cds.choreId = cs.choreId
            WHERE cds.statDate = ? AND cds.assignedCount > 0 AND cds.completedCount = 0 AND cds.missedCount = 0
            AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
            AND cds.choreId IN (SELECT id FROM chores WHERE enabled = 1)
            AND cs.time IS NOT NULL -- Only consider chores with a specific due time for "1 hour past due" check
        `, [todayDate, todayDate, currentDayOfWeek.toString()]);

        const leadTimeInMinutes = parseLeadTime(nudgrAlertLeadTimeStr);

        const reminderType = 'immediate_missed_chore'; 

        for (const chore of potentialMissedChores) {
            if (!chore.choreDueTime) continue; 

            const [dueHour, dueMinute] = chore.choreDueTime.split(':').map(Number);
            const choreDueDateTime = now.set({ hour: dueHour, minute: dueMinute, second: 0, millisecond: 0 });

            const diffInMinutes = now.diff(choreDueDateTime, 'minutes').minutes;

            if (diffInMinutes >= 60) {
                
                const reminderSent = await dbGet(
                    'SELECT id FROM reminder_log WHERE choreId = ? AND userId = ? AND sentDate = ? AND reminderType = ?',
                    [chore.choreId, chore.userId, todayDate, reminderType]
                );

                if (!reminderSent) { 
                    try {
                        const nudgrPayload = {
                            text: `Chorecast Alert: Chore '${chore.choreName}' was supposed to start at ${choreDueDateTime.toLocaleString(DateTime.TIME_SIMPLE)} and is now past due!`,
                            due_datetime: now.plus({minutes: 5}).toISO(), 
                            recipient: chore.userName, 
                            priority: 3, 
                            is_relentless: true, 
                            alert_lead_time: "0_minutes" 
                        };

                        await sendWebhook(nudgrWebhookUrl, nudgrPayload, nudgrApiKey);
                        console.log(`Nudgr webhook sent for immediate missed chore (1 hour past due): ${chore.choreName} for ${chore.userName}.`);

                        await dbRun(
                            'INSERT INTO reminder_log (choreId, userId, sentDate, reminderType) VALUES (?, ?, ?, ?)',
                            [chore.choreId, chore.userId, todayDate, reminderType]
                        );
                    } catch (webhookError) {
                        console.error(`Error sending Nudgr webhook for immediate missed chore '${chore.choreName}':`, webhookError.message);
                    }
                } else {
                    console.log(`Nudgr immediate missed reminder for chore '${chore.choreName}' already sent today. Skipping.`);
                }
            }
        }
    } catch (err) {
        console.error("Error in immediate missed chore reminder cron job:", err.message);
    }
}, {
    timezone: TIMEZONE 
});

cron.schedule('*/1 * * * *', async () => { 
    try {
        const settingsRows = await dbAll('SELECT key, value FROM settings');
        const nudgrSettings = settingsRows.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});

        const nudgrOnImportant = nudgrSettings.nudgrOnImportant === 'true';
        const nudgrWebhookUrl = nudgrSettings.nudgrWebhookUrl;
        const nudgrApiKey = nudgrSettings.nudgrApiKey;
        const nudgrIsRelentless = nudgrSettings.nudgrIsRelentless === 'true'; 
        const nudgrAlertLeadTimeStr = nudgrSettings.nudgrAlertLeadTime;

        if (!nudgrOnImportant || !nudgrWebhookUrl || !nudgrApiKey) {
            console.log('Nudgr important chore reminders are disabled or not configured.');
            return;
        }

        const now = DateTime.now().setZone(TIMEZONE);
        const todayDate = now.toISODate(); 
        const currentDayOfWeek = now.weekday % 7; 

        const importantChoresDueToday = await dbAll(`
            SELECT 
                cds.choreId, cds.userId, cds.choreName, cds.userName, cs.time as choreDueTime
            FROM chore_daily_stats cds
            JOIN chore_schedules cs ON cds.choreId = cs.choreId
            WHERE cds.statDate = ? AND cds.assignedCount > 0 AND cds.completedCount = 0 AND cds.missedCount = 0
            AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
            AND cds.choreId IN (SELECT id FROM chores WHERE important = 1 AND enabled = 1)
            AND cs.time IS NOT NULL -- Only send important reminders for chores with a specific time
        `, [todayDate, todayDate, currentDayOfWeek.toString()]);

        const leadTimeInMinutes = parseLeadTime(nudgrAlertLeadTimeStr);

        const reminderType = 'important_chore'; 

        for (const chore of importantChoresDueToday) {
            if (!chore.choreDueTime) {
                console.log(`Chore '${chore.choreName}' has no specific start time. Skipping important reminder.`);
                continue;
            }

            const [dueHour, dueMinute] = chore.choreDueTime.split(':').map(Number);
            const choreDueDateTime = now.set({ hour: dueHour, minute: dueMinute, second: 0, millisecond: 0 });

            const diffInMinutes = choreDueDateTime.diff(now, 'minutes').minutes;

            if (diffInMinutes <= leadTimeInMinutes && diffInMinutes > 0) { 
                
                const reminderSent = await dbGet(
                    'SELECT id FROM reminder_log WHERE choreId = ? AND userId = ? AND sentDate = ? AND reminderType = ?',
                    [chore.choreId, chore.userId, todayDate, reminderType]
                );

                if (!reminderSent || nudgrIsRelentless) { 
                    try {
                        
                        const nudgrPayload = {
                            text: `Chorecast Reminder: Important chore '${chore.choreName}' starts at ${choreDueDateTime.toLocaleString(DateTime.TIME_SIMPLE)}!`,
                            due_datetime: choreDueDateTime.toISO(), 
                            recipient: chore.userName, 
                            priority: 1, 
                            alert_lead_time: "0_minutes", 
                            is_relentless: nudgrIsRelentless 

                        };

                        await sendWebhook(nudgrWebhookUrl, nudgrPayload, nudgrApiKey);
                        console.log(`Nudgr webhook sent for important chore: ${chore.choreName}`);

                        await dbRun(
                            'INSERT INTO reminder_log (choreId, userId, sentDate, reminderType) VALUES (?, ?, ?, ?)',
                            [chore.choreId, chore.userId, todayDate, reminderType]
                        );
                    } catch (webhookError) {
                        console.error(`Error sending Nudgr webhook for important chore '${chore.choreName}':`, webhookError.message);
                    }
                } else {
                    console.log(`Nudgr reminder for important chore '${chore.choreName}' already sent today. Skipping.`);
                }
            }
        }
    } catch (err) {
        console.error("Error in important chore reminder cron job:", err.message);
    }
}, {
    timezone: TIMEZONE 
});

cron.schedule('* * * * *', async () => {
    try {
        const now = DateTime.now().setZone(TIMEZONE);
        const todayISODate = now.toISODate();
        const currentTime = now.toFormat('HH:mm');
        
        const currentDayOfWeekStr = (now.weekday % 7).toString();
        
        const potentialMissedChores = await dbAll(`
            SELECT 
                cds.choreId, cds.userId, cds.choreName, cds.userName, cs.time as choreDueTime
            FROM chore_daily_stats cds
            JOIN chore_schedules cs ON cds.choreId = cs.choreId
            WHERE cds.statDate = ? AND cds.assignedCount > 0 AND cds.completedCount = 0 AND cds.missedCount = 0
            AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
            AND cs.time IS NOT NULL
        `, [todayISODate, todayISODate, currentDayOfWeekStr]);
      
        for (const chore of potentialMissedChores) {
            if (!chore.choreDueTime) continue;

            const [dueHour, dueMinute] = chore.choreDueTime.split(':').map(Number);
            const choreDueDateTime = now.set({ hour: dueHour, minute: dueMinute, second: 0, millisecond: 0 });

            const diffInMinutes = now.diff(choreDueDateTime, 'minutes').minutes;

            if (diffInMinutes > 0 && diffInMinutes <= 1) {
                console.log(`Chore '${chore.choreName}' is now overdue. Sending webhook and updating status.`);

                await generateAndSendDailySummaryWebhook(chore.userId);
            }
        }

    } catch (err) {
        console.error("Error in overdue chore check cron job:", err.message);
    }
}, {
    timezone: TIMEZONE
});

cron.schedule('*/10 * * * *', async () => {
    try {
        await generateAndSendDailySummaryWebhook(); 
    } catch (err) {
        console.error("Error in daily summary webhook cron job:", err.message);
    }
}, {
    timezone: TIMEZONE
});

const port = process.env.PORT || 3737;
const useHttps = process.env.HTTPS === 'true';

let serverInstance;

if (useHttps) {
    const httpsPort = process.env.HTTPS_PORT || 3443;
    const sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
    };
    serverInstance = https.createServer(sslOptions, app).listen(httpsPort, () => {
        console.log(`HTTPS server running on port ${httpsPort}`);
        try {
            const service = bonjour.publish({
                name: 'Chorecast Web Server (HTTPS)', 
                type: 'https',
                port: httpsPort,
                protocol: 'tcp',
                host: 'chorecast.local' 
            });
            service.on('up', () => {
                console.log(`[mDNS] HTTPS service 'Chorecast Web Server (HTTPS)' is up and discoverable at https://chorecast.local:${httpsPort}`);
            });
            service.on('error', (err) => {
                console.error(`[mDNS Error] Failed to publish HTTPS service: ${err.message}`);
            });
        } catch (e) {
            console.error(`[mDNS Error] Exception while trying to publish HTTP service: ${e.message}`);
        }
    });
} else {
    serverInstance = http.createServer(app).listen(port, () => {
        console.log(`HTTP server running on port ${port}`);
        try {
            const service = bonjour.publish({
                name: 'Chorecast Web Server (HTTP)', 
                type: 'http',
                port: port,
                protocol: 'tcp',
                host: 'chorecast.local' 
            });
            service.on('up', () => {
                console.log(`[mDNS] HTTP service 'Chorecast Web Server (HTTP)' is up and discoverable at http://chorecast.local:${port}`);
            });
            service.on('error', (err) => {
                console.error(`[mDNS Error] Failed to publish HTTP service: ${err.message}`);
            });
        } catch (e) {
            console.error(`[mDNS Error] Exception while trying to publish HTTP service: ${e.message}`);
        }
    });
}

process.on('SIGTERM', () => {
    console.log('[Server Shutdown] Stopping mDNS service...');
    bonjour.unpublishAll();
    bonjour.destroy();
    serverInstance.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[Server Shutdown] Stopping mDNS service...');
    bonjour.unpublishAll();
    bonjour.destroy();
    serverInstance.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

