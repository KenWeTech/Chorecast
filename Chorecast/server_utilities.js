require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const aedes = require('aedes')();
const net = require('net');
const WebSocket = require('ws');
const wsStream = require('websocket-stream');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { DateTime } = require('luxon');
const seedrandom = require('seedrandom');
const crypto = require('crypto');

if (!process.env.JWT_SECRET) {
    console.error("CRITICAL ERROR: JWT_SECRET environment variable is not set!");
    console.error("Please create a .env file in the project root with JWT_SECRET=\"your_secret_key_here\"");
}

const MAC_VERIFY = `
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPJGUX1aDqwVUoOmqBtjmFO925g6a
n2dNuJXAScM7yvdBKUCrJdwZi7oQDRh0D8O/IDBO7QMcs9m24GHgcKoMNg==
-----END PUBLIC KEY-----
`.trim();

const CREATION_PHRASE = 'chorecast_created_by_kenwetech-please-enjoy';

const dbPath = path.join(__dirname, 'data', 'chorecast.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error(`Database connection error: ${err.message}`);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

async function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error("dbGet error:", err.message, "SQL:", sql, "Params:", params);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

async function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error("dbAll error:", err.message, "SQL:", sql, "Params:", params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.error("dbRun error:", err.message, "SQL:", sql, "Params:", params);
                reject(err);
            } else {
                resolve({ changes: this.changes, lastID: this.lastID });
            }
        });
    });
}

const updateDailyChoreStats = async (statDate, choreId, userId, choreName, userName, type, change) => {
    try {
        let initialAssigned = 0;
        let initialCompleted = 0;
        let initialMissed = 0;
        let completionTimestampUpdateClause = '';

        if (type === 'assigned') {
            initialAssigned = change;
        } else if (type === 'completed') {
            initialCompleted = change;
            const currentTimestamp = DateTime.now().setZone(process.env.TIMEZONE).toISO();
            completionTimestampUpdateClause = `, completionTimestamp = '${currentTimestamp}'`;
        } else if (type === 'missed') {
            initialMissed = change;
        } else {
            console.error(`Invalid stat type for updateDailyChoreStats: ${type}`);
            return;
        }

        const sql = `
            INSERT INTO chore_daily_stats (statDate, choreId, userId, choreName, userName, assignedCount, completedCount, missedCount, completionTimestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT completionTimestamp FROM chore_daily_stats WHERE statDate = ? AND choreId = ? AND userId = ?), ?))
            ON CONFLICT(statDate, choreId, userId) DO UPDATE SET
                choreName = EXCLUDED.choreName,
                userName = EXCLUDED.userName,
                assignedCount = MAX(assignedCount, EXCLUDED.assignedCount),
                completedCount = completedCount + EXCLUDED.completedCount,
                missedCount = missedCount + EXCLUDED.missedCount
                ${completionTimestampUpdateClause}
        `;
        const params = [
            statDate, choreId, userId, choreName, userName,
            initialAssigned, initialCompleted, initialMissed,
            statDate, choreId, userId, (type === 'completed' ? DateTime.now().setZone(process.env.TIMEZONE).toISO() : null) 
        ];

        await dbRun(sql, params);
        console.log(`Updated daily chore stats for choreId ${choreId}, userId ${userId} on ${statDate} for type ${type} by ${change}.`);

    } catch (err) {
        console.error(`Error updating daily chore stats for choreId ${choreId}, userId ${userId} on ${statDate} for type ${type}:`, err.message);
        throw err;
    }
};

function sendResponse(res, success, message, data = null, status = 200) {
    if (!success) {
        if (status === 200) {
            status = 400;
        }
    }
    res.status(status).json({ success, message, data });
}

async function sendWebhook(url, payload, apiKey = null) {
    if (!url) {
        console.warn('sendWebhook: URL is null or empty. Skipping webhook.');
        return;
    }

    let fullUrl = url;
    if (apiKey) {
        const nudgrApiPath = '/api/reminders';
        if (!fullUrl.endsWith(nudgrApiPath)) {
            fullUrl = `${fullUrl}${nudgrApiPath}`;
        }
    }

    const client = fullUrl.startsWith('https://') ? require('https') : require('http');
    const { hostname, pathname, port } = new URL(fullUrl);

    const options = {
        hostname: hostname,
        port: port || (fullUrl.startsWith('https://') ? 443 : 80),
        path: pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (apiKey) {
        options.headers['X-API-Key'] = apiKey;
    }

    return new Promise((resolve, reject) => {
        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`Webhook to ${fullUrl} response status: ${res.statusCode}`);
                console.log(`Webhook response body: ${data}`);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`Webhook failed with status: ${res.statusCode}, body: ${data}`));
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Webhook request error to ${fullUrl}: ${e.message}`);
            reject(e);
        });

        req.write(JSON.stringify(payload));
        req.end();
    });
}

function parseLeadTime(leadTimeStr) {
    if (leadTimeStr === 'no_alert' || !leadTimeStr) {
        return 0;
    }
    const parts = leadTimeStr.split('_');
    const value = parseInt(parts[0]);
    const unit = parts[1];

    if (isNaN(value)) {
        console.warn(`Invalid lead time value: ${leadTimeStr}. Defaulting to 0 minutes.`);
        return 0;
    }

    switch (unit) {
        case 'minutes':
            return value;
        case 'hour':
        case 'hours':
            return value * 60;
        default:
            console.warn(`Unknown lead time unit: ${unit}. Defaulting to 0 minutes.`);
            return 0;
    }
}

const activeModalScanRequests = new Map();

const readerToModalScanMap = new Map();

function initializeMqttBroker(mqttTcpPort, mqttWsPort) {

    aedes.authenticate = async (client, username, password, callback) => {
        if (client.id.startsWith('chorecast-reader-')) {
            callback(null, true);
            return;
        }

        if (client.id.startsWith('chorecast_frontend_')) {
            if (username && password) {
                try {
                    const token = password.toString();

                    if (!process.env.JWT_SECRET) {
                        console.error("[MQTT Auth] JWT_SECRET is not defined. Cannot authenticate frontend client.");
                        return callback(new Error('Server configuration error: JWT secret missing.'));
                    }

                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    
                    const user = await dbGet('SELECT * FROM users WHERE id = ? AND username = ? AND enabled = 1', [decoded.id, decoded.username]);

                    if (user) {
                        client.user = { id: user.id, username: user.username, isAdmin: user.isAdmin };
                        return callback(null, true);
                    } else {
                        return callback(null, false);
                    }
                } catch (jwtErr) {
                    return callback(null, false);
                }
            } else {
                return new Error('Authentication required for frontend clients.');
            }
        }

        callback(new Error('Unauthorized client.'));
    };

	aedes.authorizePublish = (client, packet, callback) => {

		if (client.id.startsWith('chorecast-reader-')) {
			const topic = packet.topic;
			const macAddress = client.id.replace('chorecast-reader-', '');

			dbGet('SELECT * FROM mac_address_bans WHERE macAddress = ?', [macAddress])
				.then(banInfo => {
					const now = DateTime.now().setZone(process.env.TIMEZONE);

					if (banInfo && banInfo.banExpiryTime) {
						const banExpiry = DateTime.fromISO(banInfo.banExpiryTime, { zone: process.env.TIMEZONE });
						if (now < banExpiry) {
							const remainingMinutes = Math.ceil(banExpiry.diff(now, 'minutes').minutes);
							console.warn(`[MQTT Auth Publish] Reader ${macAddress} is temporarily banned. Ban expires in ${remainingMinutes} minutes.`);
							aedes.publish({
								topic: `chorecast/reader/${macAddress}/command`,
								payload: JSON.stringify({
									"command": "registration_failed",
									"status": "banned",
									"message": `This device is temporarily blocked. Try again in ${remainingMinutes} minutes.`
								}),
								qos: 1,
								retain: false
							});
							return callback(new Error('Client is banned'));
						}
					}

					const rawPayload = packet.payload.toString();
					try {
						const readerData = JSON.parse(rawPayload);
						const { macAddress, ipAddress, name, model, modelHash: receivedSignature } = readerData;

						if (!macAddress) {
							aedes.publish({
								topic: `chorecast/reader/${macAddress}/command`,
								payload: '{"command":"registration_failed", "status":"error", "message":"MAC address required."}',
								qos: 1, retain: false
							});
							return callback(new Error('MAC address missing'));
						}
						
						if (topic.startsWith('chorecast/readers/register') ||
							topic.startsWith('chorecast/reader/status/') ||
							topic.startsWith('chorecast/scan/')) {

							if (!model || !receivedSignature) {
								aedes.publish({
									topic: `chorecast/reader/${macAddress}/command`,
									payload: '{"command":"registration_failed", "status":"registration_failed", "message":"Model and signature required."}',
									qos: 1, retain: false
								});
								return callback(new Error('Model or signature missing'));
							}

							const dataToVerify = model + CREATION_PHRASE;

							const verify = crypto.createVerify('SHA256');
							verify.update(dataToVerify);
							verify.end();
		
							const isSignatureValid = verify.verify(MAC_VERIFY, receivedSignature, 'hex');

							if (!isSignatureValid) {
								
								return dbGet('SELECT failedAttempts, banCount FROM mac_address_bans WHERE macAddress = ?', [macAddress])
									.then(existingBan => {
										let failedAttempts = (existingBan ? existingBan.failedAttempts : 0) + 1;
										let banCount = existingBan ? existingBan.banCount : 0;
										let banTime = null;

										if (failedAttempts >= 5) {
											failedAttempts = 0;
											banCount += 1;
											if (banCount >= 3) {
												banTime = now.plus({ hours: 24 }).toISO();
											} else {
												banTime = now.plus({ minutes: 5 }).toISO();
											}
										}

										return dbRun(
											'INSERT INTO mac_address_bans (macAddress, failedAttempts, banCount, lastAttemptTime, banExpiryTime) VALUES (?, ?, ?, ?, ?) ON CONFLICT(macAddress) DO UPDATE SET failedAttempts = EXCLUDED.failedAttempts, banCount = EXCLUDED.banCount, lastAttemptTime = EXCLUDED.lastAttemptTime, banExpiryTime = COALESCE(EXCLUDED.banExpiryTime, mac_address_bans.banExpiryTime)',
											[macAddress, failedAttempts, banCount, now.toISO(), banTime]
										);
									})
									.then(() => {
										aedes.publish({
											topic: `chorecast/reader/${macAddress}/command`,
											payload: JSON.stringify({
												"command": "registration_failed",
												"status": "unauthorized",
												"message": "Device signature is not recognized."
											}),
											qos: 1,
											retain: false
										});
										callback(new Error('Unauthorized device'));
									})
									.catch(err => {
										callback(err);
									});
							} else {
								dbRun('UPDATE mac_address_bans SET failedAttempts = 0, banCount = 0, banExpiryTime = NULL WHERE macAddress = ?', [macAddress])
									.then(() => {
										callback(null);
										
										dbRun(
											`UPDATE chorecast_readers SET ipAddress = ?, modelNumber = ? WHERE macAddress = ?`,
											[ipAddress, model, macAddress]
										).then(() => {
										}).catch(err => {
										});
									})
									.catch(err => {
										callback(err);
									});
							}
						} else {
							return callback(new Error('Unauthorized reader topic'));
						}
					} catch (parseError) {
						aedes.publish({
							topic: `chorecast/reader/${macAddress}/command`,
							payload: '{"command":"registration_failed", "status":"registration_failed", "message":"Invalid JSON payload."}',
							qos: 1, retain: false
						});
						return callback(new Error('Invalid JSON payload'));
					}
				})
				.catch(err => {
					callback(null);
				});
			return;
		}
		else if (client.user && packet.topic.startsWith('chorecast/reader/') && packet.topic.endsWith('/scan_command')) {
			callback(null);
		}
		else if (client.id.startsWith('chorecast_frontend_') && packet.topic.startsWith('chorecast/tags/scanned')) {
			callback(null);
		}
		else if (client.user && packet.topic.startsWith('chorecast/command/')) {
			callback(null);
		}
		else if (packet.topic === 'chorecast/feedback') {
			callback(null);
		}
		else if (packet.topic.startsWith('chorecast/reader/') && packet.topic.endsWith('/command')) {
			callback(null);
		}
		else {
			callback(new Error('Unauthorized publish topic'));
		}
	};
	
    aedes.authorizeSubscribe = (client, sub, callback) => {
        if (sub.topic.startsWith('chorecast/tags/scanned') || sub.topic.startsWith('chorecast/reader/') || sub.topic.startsWith('chorecast/status') || sub.topic === 'chorecast/feedback' ||
            sub.topic === 'chorecast/updates/dashboard' || sub.topic === 'chorecast/updates/statistics') {
            callback(null, sub);
        }
        else if (client.id.startsWith('chorecast_frontend_')) {
            callback(null, sub);
        }
        else if (client.user && sub.topic.startsWith('chorecast/user/')) {
            callback(null, sub);
        }
        else {
            callback(new Error('Unauthorized subscribe topic'));
        }
    };

	aedes.on('client', async (client) => {
		if (client.id.startsWith('chorecast-reader-')) {
			const readerMac = client.id.replace('chorecast-reader-', '');

			try {
				const banInfo = await dbGet('SELECT banExpiryTime FROM mac_address_bans WHERE macAddress = ?', [readerMac]);
				const now = DateTime.now().setZone(process.env.TIMEZONE);

				if (banInfo && banInfo.banExpiryTime) {
					const banExpiry = DateTime.fromISO(banInfo.banExpiryTime, { zone: process.env.TIMEZONE });
					if (now < banExpiry) {
						const remainingMinutes = Math.ceil(banExpiry.diff(now, 'minutes').minutes);
						console.warn(`[MQTT Client Connect] Reader ${readerMac} is temporarily banned. Ban expires in ${remainingMinutes} minutes. Closing connection.`);
						aedes.publish({
							topic: `chorecast/reader/${readerMac}/command`,
							payload: '{"command":"registration_failed", "status":"registration_failed", "message":"Temporarily banned."}',
							qos: 1, retain: false
						});
						setTimeout(() => {
							client.close();
						}, 500);
						return;
					}
				}

				const result = await dbRun(
					'UPDATE chorecast_readers SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE macAddress = ?',
					[readerMac]
				);

				if (result.changes > 0) {
				} else {
				}
			} catch (err) {
				console.error('[MQTT Error] Failed to update Reader on client connect or check ban status:', err.message);
			}

			setTimeout(async () => {
				try {
					const reader = await dbGet('SELECT * FROM chorecast_readers WHERE macAddress = ?', [readerMac]);

					if (reader) {
						const readerRecord = await dbGet('SELECT friendly_name, name FROM chorecast_readers WHERE macAddress = ?', [readerMac]);
						const readerDisplayName = readerRecord ? (readerRecord.friendly_name || readerRecord.name) : readerName;

						aedes.publish({ topic: `chorecast/reader/${readerMac}/command`, payload: '{"command":"registered", "status":"success"}', qos: 0, retain: false });

						aedes.publish({
							topic: `chorecast/reader/${readerMac}/status`,
							payload: JSON.stringify({
								macAddress: readerMac,
								isOnline: true,
								name: readerDisplayName
							}),
							qos: 0,
							retain: false
						});
					} else {
						console.log(`...`);
					}
				} catch (err) {
					console.error(`[MQTT] Failed to publish reader info: ${err.message}`);
				}
			}, 500);
		}
	});

    aedes.on('clientDisconnect', async (client) => {
        if (client.id.startsWith('chorecast-reader-')) {
            const readerMac = client.id.replace('chorecast-reader-', '');
            try {
                await dbRun('UPDATE chorecast_readers SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE macAddress = ?', [readerMac]);
                
				const readerRecord = await dbGet('SELECT friendly_name, name FROM chorecast_readers WHERE macAddress = ?', [readerMac]);
				const readerDisplayName = readerRecord ? (readerRecord.friendly_name || readerRecord.name) : readerName;

                aedes.publish({
                    topic: `chorecast/reader/${readerMac}/status`,
                    payload: JSON.stringify({ 
                        macAddress: readerMac, 
                        isOnline: false, 
                        name: readerDisplayName 
                    }),
                    qos: 0, retain: false
                });
            } catch (err) {
                console.error('[MQTT Error] Failed to update Reader status on disconnect:', err.message);
            }
        }
        if (client.id.startsWith('chorecast_frontend_')) {
            activeModalScanRequests.forEach((value, key) => {
                if (value.frontendClientId === client.id) {
                    activeModalScanRequests.delete(key);
                    for (let [readerMac, reqId] of readerToModalScanMap.entries()) { 
                        if (reqId === key) {
                            readerToModalScanMap.delete(readerMac);
                            break;
                        }
                    }
                }
            });
        }
    });

    aedes.on('publish', async (packet, client) => { 
        if (!client || packet.retain || packet.cmd === 'pubrel') return;
        
    const topic = packet.topic;
    const payload = packet.payload.toString();

    if (topic === 'chorecast/readers/register' && client.id.startsWith('chorecast-reader-')) {
        try {
            const regData = JSON.parse(payload);
            const { macAddress, ipAddress, name, model, modelHash } = regData; 

            if (!macAddress) {
                return;
            }

            const readerName = name && name.trim() !== '' ? name : `Chorecast Reader ${macAddress.replace(/:/g, '').slice(-6).toUpperCase()}`;
			const readerRecord = await dbGet('SELECT friendly_name, name FROM chorecast_readers WHERE macAddress = ?', [macAddress]);
			const readerDisplayName = readerRecord ? (readerRecord.friendly_name || readerRecord.name) : readerName;

            await dbRun(`
                INSERT INTO chorecast_readers (macAddress, name, isOnline, lastSeen, modelNumber, ipAddress)
				VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
				ON CONFLICT(macAddress) DO UPDATE SET
					name = name,
					isOnline = 1,
					lastSeen = CURRENT_TIMESTAMP,
					modelNumber = modelNumber, 
					ipAddress = ipAddress; 
				`, [macAddress, readerName, model, ipAddress]); 
				
                aedes.publish({ topic: `chorecast/reader/${macAddress}/command`, payload: '{"command":"registered", "status":"success"}', qos: 0, retain: false });
                
				aedes.publish({
                    topic: `chorecast/reader/${macAddress}/status`,
                    payload: JSON.stringify({ macAddress: macAddress, isOnline: true, name: readerDisplayName, modelNumber: model, ipAddress: ipAddress }),
                    qos: 0, retain: false
                });

            } catch (error) {
                console.error('[MQTT Register Error]:', error.message, 'Payload:', payload);
                if (client && client.id.startsWith('chorecast-reader-')) {
                    const readerMac = client.id.replace('chorecast-reader-', '');
                    aedes.publish({ topic: `chorecast/reader/${readerMac}/command`, payload: '{"command":"registration_failed", "status":"registration_failed", "message":"Failed to process registration"}' });
                }
            }
        }

        else if (topic.startsWith('chorecast/reader/status/') && client.id.startsWith('chorecast-reader-')) {
            const readerMac = client.id.replace('chorecast-reader-', '');
            if (!topic.endsWith(readerMac)) {
                aedes.publish({ topic: `chorecast/reader/${readerMac}/command`, payload: '{"command":"status_rejected", "status":"status_rejected", "message":"Mismatched MAC in topic"}' });
                return;
            }

            try {
                const statusData = JSON.parse(payload);
                const { macAddress, isOnline, name, ipAddress, model, modelHash } = statusData;

                const readerName = name && name.trim() !== '' ? name : `Chorecast Reader ${macAddress.replace(/:/g, '').slice(-6).toUpperCase()}`;
				const readerRecord = await dbGet('SELECT friendly_name, name FROM chorecast_readers WHERE macAddress = ?', [macAddress]);
				const readerDisplayName = readerRecord ? (readerRecord.friendly_name || readerRecord.name) : readerName;
                
                if (macAddress) {
                    await dbRun(`
                        INSERT INTO chorecast_readers (macAddress, name, isOnline, lastSeen, ipAddress, modelNumber)
						VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
						ON CONFLICT(macAddress) DO UPDATE SET
                            name = EXCLUDED.name,
                            isOnline = 1,
                            lastSeen = CURRENT_TIMESTAMP,
                            ipAddress = COALESCE(EXCLUDED.ipAddress, ipAddress), 
							modelNumber = COALESCE(EXCLUDED.modelNumber, modelNumber); 
                    `, [macAddress, readerName, ipAddress, model]);
                    
					aedes.publish({ topic: `chorecast/reader/${macAddress}/command`, payload: '{"command":"status_updated", "status":"status_updated"}', qos: 0, retain: false });
                    
                    aedes.publish({
                        topic: `chorecast/reader/${macAddress}/status`, 
                        payload: JSON.stringify({ macAddress: macAddress, isOnline: isOnline, name: readerDisplayName, ipAddress: ipAddress, modelNumber: model }),
                        qos: 0, retain: false
                    });
                }
            } catch (error) {
                console.error('[MQTT Reader Status Error]:', error.message);
            }
        }
        
        else if (topic.startsWith('chorecast/reader/') && topic.endsWith('/scan_command') && client.id.startsWith('chorecast_frontend_')) {
            try {
                const { command, userId, username, requestId } = JSON.parse(payload);
                if (command === 'start_scan' && requestId) {
                    activeModalScanRequests.set(requestId, { userId, username, frontendClientId: client.id });

                    const onlineReaders = await dbAll('SELECT macAddress FROM chorecast_readers WHERE isOnline = 1');
                    if (onlineReaders.length > 0) {
                        const targetReaderMac = onlineReaders[0].macAddress;
                        readerToModalScanMap.set(targetReaderMac, requestId);
                        
                        const readerCommandPayload = JSON.stringify({ command: 'start_scan', requestId: requestId });
                        aedes.publish({ topic: `chorecast/reader/${targetReaderMac}/command`, payload: readerCommandPayload, qos: 1, retain: false });
                    } else {
                        aedes.publish({
                            topic: 'chorecast/feedback',
                            payload: JSON.stringify({
                                type: 'tag_scan_modal_feedback',
                                status: 'error',
                                message: 'No online readers available to scan. Please ensure a reader is connected and online.',
                                requestId: requestId
                            }),
                            qos: 0, 
                            retain: false
                        });
                        activeModalScanRequests.delete(requestId);
                    }
                }
            } catch (e) {
                console.error("[MQTT Scan Command Error]:", e.message, "Payload:", payload);
                try {
                    const { requestId } = JSON.parse(payload);
                    if (requestId) {
                        aedes.publish({
                            topic: 'chorecast/feedback',
                            payload: JSON.stringify({
                                type: 'tag_scan_modal_feedback',
                                status: 'error',
                                message: 'Error processing scan command on server.',
                                requestId: requestId
                            }),
                            qos: 0, 
                            retain: false
                        });
                        activeModalScanRequests.delete(requestId);
                    }
                } catch (parseError) {
                    console.error("Failed to parse payload for error feedback:", parseError);
                }
            }
        }
        else if (topic.startsWith('chorecast/scan/') && client.id.startsWith('chorecast-reader-')) {
            const readerMac = client.id.replace('chorecast-reader-', '');
            try {
                const data = JSON.parse(payload);
                const { nfcTagId, requestId, status, message } = data;

                const modalRequestId = readerToModalScanMap.get(readerMac);
                if (modalRequestId && activeModalScanRequests.has(modalRequestId)) {
                    let feedbackPayload = {
                        type: 'tag_scan_modal_feedback',
                        status: 'success',
                        message: 'Tag scanned successfully!',
                        nfcTagId: nfcTagId || '',
                        requestId: modalRequestId
                    };
                    if (status === 'error' || !nfcTagId) {
                        feedbackPayload.status = 'error';
                        feedbackPayload.message = message || 'No tag ID was detected.';
                    }
                    aedes.publish({ topic: 'chorecast/feedback', payload: JSON.stringify(feedbackPayload), qos: 0, retain: false });
                    activeModalScanRequests.delete(modalRequestId);
                    readerToModalScanMap.delete(readerMac);
                    return;
                }

                let currentSignedInUser = null;
                const settingsRows = await dbAll('SELECT key, value FROM settings');
                const settings = settingsRows.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
                const authMethod = settings.authMethod || 'reader_assigned';

                if (authMethod === 'user_tag_signin') {
                    const session = await dbGet('SELECT userId FROM reader_sessions WHERE readerMacAddress = ?', [readerMac]);
                    if (session) {
                        currentSignedInUser = await dbGet('SELECT id, username, isAdmin FROM users WHERE id = ?', [session.userId]);
                    }
                } else {
                    currentSignedInUser = await dbGet('SELECT u.id, u.username, u.isAdmin FROM users u JOIN chorecast_readers r ON u.assignedReaderId = r.id WHERE r.macAddress = ?', [readerMac]);
                }

                const sendFeedback = (feedbackMessage, readerCommandStatus, toastStatus = 'info') => {
                    if (currentSignedInUser) {
                        aedes.publish({
                            topic: `chorecast/user/${currentSignedInUser.id}/status`,
                            payload: JSON.stringify({ status: toastStatus, message: feedbackMessage }),
                            qos: 0, retain: false
                        });
                    }
                    aedes.publish({
                        topic: `chorecast/reader/${readerMac}/command`,
                        payload: JSON.stringify({ status: readerCommandStatus, message: feedbackMessage }),
                        qos: 0, retain: false
                    });
                };

                if (!nfcTagId) return sendFeedback('No tag was detected.', 'no_tag_detected', 'error');

                if (settings.signOutTagId && nfcTagId === settings.signOutTagId) {
                    const userWhoSignedOut = currentSignedInUser ? currentSignedInUser.username : 'A user';
                    aedes.publish({ topic: 'chorecast/feedback', payload: JSON.stringify({ type: 'user_signed_out', message: `${userWhoSignedOut} signed out.`, status: 'success' }), qos: 0, retain: false });
                    aedes.publish({ topic: `chorecast/reader/${readerMac}/command`, payload: `{"status":"signed_out", "message":"Signed Out"}`, qos: 0, retain: false });
                    await dbRun('DELETE FROM reader_sessions WHERE readerMacAddress = ?', [readerMac]);
                    return;
                }

                const tag = await dbGet('SELECT * FROM nfc_tags WHERE tagId = ?', [nfcTagId]);
                if (!tag) return sendFeedback('Tag not found in database.', 'tag_not_found', 'error');

                if (tag.type === 'user') {
                    const userForTag = await dbGet('SELECT * FROM users WHERE nfcTagId = ? AND enabled = 1', [tag.tagId]);
                    if (userForTag && authMethod === 'user_tag_signin') {
                        await dbRun('INSERT OR REPLACE INTO reader_sessions (readerMacAddress, userId, signedInAt) VALUES (?, ?, CURRENT_TIMESTAMP)', [readerMac, userForTag.id]);
                        aedes.publish({ topic: 'chorecast/feedback', payload: JSON.stringify({ type: 'user_signed_in', message: `Welcome, ${userForTag.username}!`, status: 'success', userId: userForTag.id, username: userForTag.username, readerMacAddress: readerMac }), qos: 0, retain: false });
                        aedes.publish({ topic: `chorecast/reader/${readerMac}/command`, payload: `{"status":"signed_in", "message":"Hi, ${userForTag.username}"}`, qos: 0, retain: false });
                    } else if (authMethod !== 'user_tag_signin') {
                        sendFeedback('Sign-in tags are not active.', 'auth_method_mismatch', 'error');
                    } else {
                        sendFeedback('User for tag not found or disabled.', 'user_not_found_or_disabled', 'error');
                    }
                    return;
                }

                if (tag.type === 'chore') {
                    if (!currentSignedInUser) {
                        return sendFeedback('No user is signed in to this reader.', 'no_user_signed_in', 'error');
                    }

                    const chore = await dbGet('SELECT * FROM chores WHERE nfcTagId = ? AND enabled = 1', [tag.tagId]);
                    if (!chore) {
                        return sendFeedback('Chore for this tag not found or disabled.', 'chore_not_found_or_disabled', 'error');
                    }
                    
                    const TIMEZONE = process.env.TIMEZONE;
                    const now = DateTime.now().setZone(TIMEZONE);
                    const currentDate = now.toISODate();
                    const currentDayOfWeek = now.weekday % 7;

                    const schedulesForToday = await dbAll(`
                        SELECT * FROM chore_schedules WHERE choreId = ? AND (
                            (scheduleType = 'daily') OR
                            (scheduleType = 'once' AND specificDate = ?) OR
                            (scheduleType = 'weekly' AND INSTR(daysOfWeek, ?) > 0)
                        )`, [chore.id, currentDate, currentDayOfWeek.toString()]
                    );

                    if (schedulesForToday.length === 0) {
                        return sendFeedback(`Chore '${chore.name}' is not scheduled for today.`, 'not_due_or_assigned', 'error');
                    }

                    const relevantSchedule = schedulesForToday[0];
                    if (relevantSchedule.time) {
                        const [scheduleHour, scheduleMinute] = relevantSchedule.time.split(':').map(Number);
                        const scheduleDateTime = now.set({ hour: scheduleHour, minute: scheduleMinute, second: 0, millisecond: 0 });
                        if (now < scheduleDateTime) {
                            return sendFeedback(`Chore '${chore.name}' does not start until ${relevantSchedule.time}.`, 'not_due_or_assigned', 'error');
                        }
                    }

                    let isAuthorized = false;
                    let assignedUserForFeedback = null;

                    if (chore.assignmentType === 'manual') {
                        if (schedulesForToday.some(s => s.assignedUserId === currentSignedInUser.id)) {
                            isAuthorized = true;
                        }
                    } else {
                        const assignedUserIdForToday = await getAssignedUserForDay(chore.id, chore.assignmentType, currentDate);
                        
                        if (assignedUserIdForToday) {
                            const assignedUserDetails = await dbGet('SELECT username FROM users WHERE id = ?', [assignedUserIdForToday]);
                            if (assignedUserDetails) {
                                assignedUserForFeedback = assignedUserDetails.username;
                            }
                        }

                        if (assignedUserIdForToday === currentSignedInUser.id) {
                            isAuthorized = true;
                        }

                    }
					
					if (!isAuthorized) {
                        const feedbackMessage = assignedUserForFeedback 
                            ? `Not your turn! This chore is assigned to ${assignedUserForFeedback} today.`
                            : `This chore is not assigned to you today.`;
                        return sendFeedback(feedbackMessage, 'not_assigned_to_user', 'error');
                    }
					
					const alreadyCompleted = await dbGet(`SELECT 1 FROM chore_log WHERE choreId = ? AND userId = ? AND assignedDate = ? AND completedAt IS NOT NULL`, [chore.id, currentSignedInUser.id, currentDate]);
                    if (alreadyCompleted) {
                        return sendFeedback(`Chore '${chore.name}' already completed!`, 'already_completed', 'warning');
                    }

                    const completedAtISO = now.toISO();
                    await dbRun('INSERT INTO chore_log (choreId, userId, assignedDate, completedAt, readerMacAddress, status) VALUES (?, ?, ?, ?, ?, ?)', [chore.id, currentSignedInUser.id, currentDate, completedAtISO, readerMac, 'completed']);
                    
                    sendFeedback(`Chore '${chore.name}' done!`, 'chore_completed', 'success');
                    
                    if (!currentSignedInUser.isAdmin) {
                        aedes.publish({ 
                            topic: 'chorecast/feedback', 
                            payload: JSON.stringify({ type: 'chore_completed', status: 'success', message: `Chore "${chore.name}" completed by ${currentSignedInUser.username}!`}), 
                            qos: 0, 
                            retain: false 
                        });
                    }
                    
                    await updateDailyChoreStats(currentDate, chore.id, currentSignedInUser.id, chore.name, currentSignedInUser.username, 'completed', 1);
                    await generateAndSendDailySummaryWebhook();
                    return;
                }

                return sendFeedback(`Tag type '${tag.type}' is not supported for scans.`, 'unsupported_tag_type', 'error');

            } catch (e) {
                console.error("Error processing NFC scan:", e.message, "Payload:", payload);
                if (client.id.startsWith('chorecast-reader-')) {
                    aedes.publish({ topic: `chorecast/reader/${client.id.replace('chorecast-reader-',' ')}/command`, payload: '{"status":"error", "message":"Internal server error"}', qos: 0, retain: false });
                }
            }
        }
    });

    setInterval(async () => {
        const staleThresholdMinutes = 3;
        const thresholdTimeUTC = DateTime.utc().minus({ minutes: staleThresholdMinutes }).toSQL({ includeOffset: false });
        try {
            const staleReaders = await dbAll(`SELECT macAddress, name, ipAddress, modelNumber, lastSeen FROM chorecast_readers WHERE isOnline = 1 AND lastSeen < ?`, [thresholdTimeUTC]);
            if (staleReaders.length > 0) {
                for (const reader of staleReaders) {
                    console.log(`  - Marking offline: ${reader.name} (${reader.macAddress}), lastSeen: ${reader.lastSeen}`);
                    await dbRun('UPDATE chorecast_readers SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE macAddress = ?', [reader.macAddress]);
                    aedes.publish({
                        topic: `chorecast/reader/${reader.macAddress}/status`,
                        payload: JSON.stringify({ 
                            macAddress: reader.macAddress, 
                            isOnline: false, 
                            name: reader.name, 
                            ipAddress: reader.ipAddress, 
                            modelNumber: reader.modelNumber 
                        }),
                        qos: 0, retain: false
                    });
                }
            }
        } catch (error) {
            console.error('[Stale Reader Check Error]:', error.message);
        }
    }, 3 * 60 * 1000);

    const server = net.createServer(aedes.handle);
    server.listen(mqttTcpPort, () => {
        console.log(`MQTT TCP server listening on port ${mqttTcpPort}`);
    });

    const httpServer = http.createServer();
    const wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (wsInstance) => { 
        const stream = wsStream(wsInstance);
        aedes.handle(stream);
        stream.on('error', (err) => {
            console.error('[MQTT WS Stream Error]', err.message);
        });
    });
    httpServer.listen(mqttWsPort, () => {
        console.log(`MQTT WebSocket server listening on port ${mqttWsPort}`);
    });
}

async function determineAssignedUserForPoolChore(choreId, assignmentType) {
    const assignedUsers = await dbAll(
        'SELECT userId FROM chore_assignments WHERE choreId = ? ORDER BY userId ASC',
        [choreId]
    );

    if (!assignedUsers || assignedUsers.length === 0) {
        return null;
    }

    const userIds = assignedUsers.map(u => u.userId);
    let nextUserId = null;

    if (assignmentType === 'shuffle') {
        const randomIndex = Math.floor(Math.random() * userIds.length);
        nextUserId = userIds[randomIndex];
    } else if (assignmentType === 'round_robin') {
        const chore = await dbGet('SELECT lastAssignedUserId FROM chores WHERE id = ?', [choreId]);
        const lastAssignedUserId = chore ? chore.lastAssignedUserId : null;

        if (lastAssignedUserId) {
            const lastIndex = userIds.indexOf(lastAssignedUserId);
            if (lastIndex === -1) {
                nextUserId = userIds[0];
            } else {
                const nextIndex = (lastIndex + 1) % userIds.length;
                nextUserId = userIds[nextIndex]; 
            }
        } else {
            nextUserId = userIds[0];
        }
    }

    if (nextUserId && assignmentType === 'round_robin') {
        await dbRun('UPDATE chores SET lastAssignedUserId = ? WHERE id = ?', [nextUserId, choreId]);
    }

    return nextUserId;
}

async function getAssignedUserForDay(choreId, assignmentType, forDate) {
    const assignedUsers = await dbAll('SELECT userId FROM chore_assignments WHERE choreId = ? ORDER BY userId ASC', [choreId]);
    if (!assignedUsers || assignedUsers.length === 0) {
        return null;
    }

    const userIds = assignedUsers.map(u => u.userId);
    
    if (assignmentType === 'shuffle') {
        const seed = `${choreId}-${forDate}`;
        const rng = seedrandom(seed);
        const randomIndex = Math.floor(rng() * userIds.length);
        return userIds[randomIndex];

    } else if (assignmentType === 'round_robin') {
        const epoch = DateTime.fromISO('2024-01-01'); 
        const targetDate = DateTime.fromISO(forDate);
        const daysSinceEpoch = Math.floor(targetDate.diff(epoch, 'days').days);
        
        const assignedIndex = daysSinceEpoch % userIds.length;
        return userIds[assignedIndex];
    }
    
    return null;
}

async function getAppSettings() {
    const settingsRows = await dbAll('SELECT key, value FROM settings');
    return settingsRows.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
}

async function generateAndSendDailySummaryWebhook() {
    console.log('[HA Webhook] Generating and sending daily summary...');
    try {
        const appSettings = await getAppSettings();
        const haWebhookUrl = appSettings.haWebhookUrl;
        if (!haWebhookUrl) {
            console.log('[HA Webhook] Home Assistant webhook URL is not configured. Skipping daily summary.');
            return;
        }

        const TIMEZONE = appSettings.timezone || process.env.TIMEZONE;
        const now = DateTime.now().setZone(TIMEZONE);
        const currentDate = now.toISODate();
        const currentDayOfWeek = now.weekday % 7;

        const allChoresDueToday = await dbAll(`
            SELECT DISTINCT c.id, c.name, c.area, c.duration, c.important, c.assignmentType, cs.time
            FROM chores c JOIN chore_schedules cs ON c.id = cs.choreId
            WHERE c.enabled = 1 AND (
                (cs.scheduleType = 'daily') OR
                (cs.scheduleType = 'once' AND cs.specificDate = ?) OR
                (cs.scheduleType = 'weekly' AND INSTR(cs.daysOfWeek, ?) > 0)
            )
        `, [currentDate, currentDayOfWeek.toString()]);

        const futureDueChores = [];
        const realTimeMissedChores = [];
        const allAssignedUsersToday = new Set();
        const allUncompletedChores = [];

        for (const chore of allChoresDueToday) {
            let assignedUserIdForToday = null;
            if (chore.assignmentType === 'manual') {
                const manualAssignments = await dbAll(
                    `SELECT assignedUserId FROM chore_schedules WHERE choreId = ? AND assignedUserId IS NOT NULL AND (
                        (scheduleType = 'daily') OR (scheduleType = 'once' AND specificDate = ?) OR (scheduleType = 'weekly' AND INSTR(daysOfWeek, ?) > 0)
                    )`, [chore.id, currentDate, currentDayOfWeek.toString()]
                );
                if (manualAssignments.length > 0) assignedUserIdForToday = manualAssignments[0].assignedUserId;
            } else {
                assignedUserIdForToday = await getAssignedUserForDay(chore.id, chore.assignmentType, currentDate);
            }

            if (assignedUserIdForToday) {
                const user = await dbGet('SELECT username FROM users WHERE id = ?', [assignedUserIdForToday]);
                if (user) {
                    allAssignedUsersToday.add(user.username);
                    const isCompleted = await dbGet(`
                        SELECT 1 FROM chore_log WHERE choreId = ? AND userId = ? AND assignedDate = ? AND completedAt IS NOT NULL
                    `, [chore.id, assignedUserIdForToday, currentDate]);

                    if (!isCompleted) {
                        const choreDueDateTime = chore.time ?
                            now.set({ hour: chore.time.split(':')[0], minute: chore.time.split(':')[1], second: 0, millisecond: 0 }) :
                            now.startOf('day');

                        const choreDataPayload = {
                            chore_name: chore.name, username: user.username, due_time: choreDueDateTime.toISO(),
                            area: chore.area, duration_minutes: chore.duration, important: chore.important
                        };
                        
                        allUncompletedChores.push(choreDataPayload);

                        if (choreDueDateTime >= now) {
                            futureDueChores.push(choreDataPayload);
                        } else if (chore.time && now > choreDueDateTime.plus({ hours: 1 })) {
                            realTimeMissedChores.push(choreDataPayload);
                        }
                    }
                }
            }
        }

        futureDueChores.sort((a, b) => DateTime.fromISO(a.due_time).toMillis() - DateTime.fromISO(b.due_time).toMillis());
        const nextDueChore = futureDueChores.length > 0 ? futureDueChores[0] : null;

        const completedChoresList = await dbAll(`
            SELECT c.name AS chore_name, u.username, cl.completedAt AS completion_time
            FROM chore_log cl JOIN chores c ON cl.choreId = c.id JOIN users u ON cl.userId = u.id
            WHERE cl.assignedDate = ? AND cl.completedAt IS NOT NULL ORDER BY cl.completedAt DESC
        `, [currentDate]);
        const lastCompletedChore = completedChoresList.length > 0 ? completedChoresList[0] : null;

        const userStatsToday = {};
        allAssignedUsersToday.forEach(username => {
            userStatsToday[username] = { completed: 0, missed: 0, next_due: null, last_completed: null };
        });

        completedChoresList.forEach(chore => {
            if (userStatsToday[chore.username]) {
                userStatsToday[chore.username].completed += 1;
                if (!userStatsToday[chore.username].last_completed) {
                    userStatsToday[chore.username].last_completed = {
                        chore_name: chore.chore_name,
                        completion_time: chore.completion_time
                    };
                }
            }
        });

        realTimeMissedChores.forEach(chore => {
            if (userStatsToday[chore.username]) userStatsToday[chore.username].missed += 1;
        });

        allAssignedUsersToday.forEach(username => {
            const userNextDue = allUncompletedChores
                .filter(chore => chore.username === username && DateTime.fromISO(chore.due_time) >= now)
                .sort((a, b) => DateTime.fromISO(a.due_time).toMillis() - DateTime.fromISO(b.due_time).toMillis());

            if (userNextDue.length > 0) {
                userStatsToday[username].next_due = {
                    chore_name: userNextDue[0].chore_name,
                    due_time: userNextDue[0].due_time
                };
            }
        });

        const haPayload = {
            event_type: "chorecast_daily_summary",
            data: {
                current_date: currentDate,
                total_chores_due_today: allChoresDueToday.length,
                total_chores_completed_today: completedChoresList.length,
                total_chores_missed_today: realTimeMissedChores.length,
                last_completed_chore: lastCompletedChore,
                next_due_chore: nextDueChore,
                completed_chores_list: completedChoresList,
                missed_chores_list: realTimeMissedChores,
                user_stats_today: userStatsToday
            }
        };

        await sendWebhook(haWebhookUrl, haPayload);
        console.log('[HA Webhook] Successfully sent daily summary to Home Assistant.');

    } catch (error) {
        console.error('[HA Webhook Error] Failed to send daily summary webhook:', error.message);
    }
}

module.exports = {
    db,
    dbGet,
    dbAll,
    dbRun,
    initializeMqttBroker,
    aedes,
    sendWebhook,
    sendResponse,
    parseLeadTime,
    updateDailyChoreStats,
    determineAssignedUserForPoolChore,
	getAssignedUserForDay,
    generateAndSendDailySummaryWebhook,
    getAppSettings
};
