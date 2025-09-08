import { DateTime } from '../lib/luxon/luxon.min.js';

export const appState = {
    currentPage: 'dashboard', 

    user: null, 

    readers: [],
    chores: [],
    tags: [],
    users: [], 

    settings: {},
    config: { 

        mqttWsPort: 8887, 

        authMethod: 'reader_assigned', 

        timezone: 'America/New_York' 

    },
    onSettingsUpdated: null,
	mqttClient: null,
    isMqttConnected: false,
    mqttConnectAttempts: 0,
    maxMqttConnectAttempts: 5,
    mqttReconnectInterval: 5000, 

    nfcScanFeedbackTimeout: null, 

    activeReaderSession: null, 

    isTagScanModalActive: false, 

    dashboardViewMode: 'my_chores', 

    onLoginSuccess: null, 

    onLogout: null,
    onReaderStatusUpdate: null,
    onDashboardUpdated: null, 

    onStatisticsUpdated: null, 

    onSettingsUpdated: null,
    onNfcScanFeedback: null, 

    ui: {
        mainContent: null,
        loadingSpinner: null, 

        toastContainer: null,
        infoModal: null, 

        infoModalTitle: null,
        infoModalMessage: null,
        infoModalConfirmBtn: null, 

        infoModalCancelBtn: null, 

        infoModalCloseBtn: null, 

        tagScanModal: null,
        tagIdInput: null,
        listenForTagBtn: null,
        tagScanFeedback: null 

    }
};

export function showLoadingOverlay() {
    if (appState.ui.loadingSpinner) {
        appState.ui.loadingSpinner.style.display = 'block'; 

    }
}

export function hideLoadingOverlay() {
    if (appState.ui.loadingSpinner) {
        appState.ui.loadingSpinner.style.display = 'none'; 

    }
}

export function showToast(message, type = 'info', duration = 3000, timezone = appState.config.timezone) {
    if (!appState.ui.toastContainer) {
        console.warn("Toast container not found. Cannot show toast:", message);
        return;
    }
    const toast = document.createElement('div');
    toast.classList.add('toast-message'); 

    if (type) {
        toast.classList.add(type); 

    }
    toast.textContent = message;

    appState.ui.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
    }, 10); 

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.ontransitionend = () => toast.remove();
    }, duration);
}

export function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('is-visible');

        modal.addEventListener('transitionend', function handler() {
            modal.classList.add('hidden');
            modal.removeEventListener('transitionend', handler);
        }, { once: true });

        if (modalId === 'tag-modal') {
            appState.isTagScanModalActive = false;
            appState.onNfcScanFeedback = null; 

            const tagIdInput = appState.ui.tagIdInput; 

            const listenForTagBtn = appState.ui.listenForTagBtn; 

            const tagScanFeedback = appState.ui.tagScanFeedback; 

            if (tagIdInput) tagIdInput.value = '';
            if (listenForTagBtn) {
                listenForTagBtn.disabled = false;
                listenForTagBtn.textContent = 'Listen for Scan';
            }
            if (tagScanFeedback) { 

                tagScanFeedback.textContent = 'Place an NFC tag on the reader.';
                tagScanFeedback.style.color = 'black';
            }
            clearTimeout(appState.nfcScanFeedbackTimeout); 

        }
    }
}

export function showInfoModal(title, message, type = 'info', isConfirm = false) {
    return new Promise((resolve) => {
        const modal = appState.ui.infoModal;
        const modalTitle = appState.ui.infoModalTitle;
        const modalMessage = appState.ui.infoModalMessage;
        const confirmBtn = appState.ui.infoModalConfirmBtn; 

        const cancelBtn = appState.ui.infoModalCancelBtn; 

        const closeBtn = appState.ui.infoModalCloseBtn; 

        if (!modal || !modalTitle || !modalMessage || !confirmBtn || !cancelBtn || !closeBtn) {
            console.error("Info/Confirmation modal elements not found in appState.ui.");

            if (isConfirm) {
                resolve(window.confirm(message));
            } else {
                window.alert(message);
            }
            return;
        }

        modalTitle.textContent = title;
        modalMessage.textContent = message;

        confirmBtn.classList.add('hidden'); 

        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;

        modalTitle.classList.remove('status-online', 'status-offline', 'warning-text', 'info-text'); 

        switch (type) {
            case 'success': modalTitle.classList.add('status-online'); break; 

            case 'error': modalTitle.classList.add('status-offline'); break; 

            case 'warning': modalTitle.classList.add('warning-text'); break; 

            case 'info': default: modalTitle.classList.add('info-text'); break; 

        }

        const onConfirmAction = () => {
            hideModal('info-modal');
            resolve(true);
        };

        const onCancelAction = () => {
            hideModal('info-modal');
            resolve(false);
        };

        if (isConfirm) {
            confirmBtn.classList.remove('hidden'); 

            confirmBtn.textContent = 'OK'; 

            confirmBtn.classList.remove('secondary-btn', 'delete-btn'); 

            confirmBtn.classList.add('primary-btn'); 

            confirmBtn.addEventListener('click', onConfirmAction);

            cancelBtn.textContent = 'Cancel'; 

            cancelBtn.classList.remove('primary-btn', 'delete-btn'); 

            cancelBtn.classList.add('secondary-btn'); 

            cancelBtn.addEventListener('click', onCancelAction);

            closeBtn.addEventListener('click', onCancelAction);
        } else {

            cancelBtn.classList.remove('hidden'); 

            cancelBtn.textContent = 'Close';
            cancelBtn.classList.remove('primary-btn', 'delete-btn'); 

            cancelBtn.classList.add('secondary-btn'); 

            cancelBtn.addEventListener('click', onCancelAction); 

            closeBtn.addEventListener('click', onCancelAction);
        }

        modal.classList.remove('hidden');
        modal.classList.add('is-visible');
    });
}

export function showConfirmModal(title, message) {

    return showInfoModal(title, message, 'warning', true);
}

export const api = {

    setAuthToken: function(token) {
        this.authToken = token;
    },

    clearAuthToken: function() {
        this.authToken = null;
    },

    _sendRequest: async function(method, endpoint, data = null, requiresAuth = true) {
        const url = `/api${endpoint}`; 

        const headers = {
            'Content-Type': 'application/json',
        };

        if (requiresAuth) {

            if (this.authToken) { 

                headers['Authorization'] = `Bearer ${this.authToken}`;
            } else {
                console.warn(`API request to ${url} requires auth but no token found. Forcing logout.`);

                logoutUser();
                throw new Error('No authentication token found.');
            }
        }

        const options = {
            method: method,
            headers: headers,
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);

            const responseData = await response.json().catch(() => ({ message: `HTTP error! status: ${response.status}` }));

            if ((response.status === 401 || response.status === 403) && endpoint !== '/login') { 

                console.warn(`API request to ${url} failed with ${response.status}. Token likely invalid/expired. Forcing logout.`);
                logoutUser(); 

                throw new Error('Authentication failed: Invalid or expired token.');
            }

            if (!response.ok) {
                throw new Error(responseData.message || `HTTP error! status: ${response.status}`);
            }
            return responseData; 

        } catch (error) {
            console.error(`API request failed (${method} ${url}):`, error);
            throw error; 

        }
    },

    login: function(username, password) {
        return this._sendRequest('POST', '/login', { username, password }, false);
    },

    getConfig: function() {
        return this._sendRequest('GET', '/config', null, false); 

    },
    getReaders: function() {
        return this._sendRequest('GET', '/readers');
    },
    deleteReader: function(id) {
        return this._sendRequest('DELETE', `/readers/${id}`);
    },
    updateReaderName: function(macAddress, friendly_name) {
        return this._sendRequest('PUT', `/readers/${macAddress}/name`, { friendly_name });
    },
    getTags: function() {
        return this._sendRequest('GET', '/tags');
    },
    createTag: function(tagData) {
        return this._sendRequest('POST', '/tags', tagData);
    },
    updateTag: function(id, tagData) { 

        return this._sendRequest('PUT', `/tags/${id}`, tagData);
    },
    deleteTag: function(id) { 

        return this._sendRequest('DELETE', `/tags/${id}`);
    },
    getUsers: function() {
        return this._sendRequest('GET', '/users');
    },
    createUser: function(userData) {
        return this._sendRequest('POST', '/users', userData);
    },
    updateUser: function(id, userData) {
        return this._sendRequest('PUT', `/users/${id}`, userData);
    },
    deleteUser: function(id) {
        return this._sendRequest('DELETE', `/users/${id}`);
    },
    getChores: function() {
        return this._sendRequest('GET', '/chores');
    },
    getChoreDetails: function(id) {
        return this._sendRequest('GET', `/chores/${id}`);
    },
    createChore: function(choreData) {
        return this._sendRequest('POST', '/chores', choreData);
    },
    updateChore: function(id, choreData) {
        return this._sendRequest('PUT', `/chores/${id}`, choreData);
    },
    deleteChore: function(id) {
        return this._sendRequest('DELETE', `/chores/${id}`);
    },
    getUserReaderStatus: function() {
        return this._sendRequest('GET', '/user/reader-status');
    },
    getDashboardData: function(userId, viewMode = 'my_chores') {
        return this._sendRequest('GET', `/dashboard/today/${userId}?viewMode=${viewMode}`);
    },
    getSettings: function() {
        return this._sendRequest('GET', '/settings');
    },
    saveSettings: function(settingsData) {
        return this._sendRequest('POST', '/settings', settingsData);
    },
    getStatsSummary: function(period, userId = '') {
        return this._sendRequest('GET', `/stats/summary?period=${period}&userId=${userId}`);
    },
    clearStatistics: function(options) {
        return this._sendRequest('DELETE', '/stats/clear', options);
    },
	clearMacAddressBans: function() {
		return this._sendRequest('DELETE', '/mac-address-bans');
	}
};

export function connectMqtt() {
    if (appState.isMqttConnected && appState.mqttClient && appState.mqttClient.connected) {
        console.log("MQTT client already connected.");
        return;
    }

    if (!appState.user || !appState.user.username || !appState.user.token) {
        console.warn("Cannot connect to MQTT: User not logged in or missing credentials.");
        showToast("Cannot connect to MQTT: Please log in.", "error");
        return;
    }

    if (appState.mqttConnectAttempts >= appState.maxMqttConnectAttempts) {
        console.error("Max MQTT connection attempts reached. Not retrying.");
        showToast("Could not connect to MQTT broker. Features may be limited.", "error");
        return;
    }

    showToast("Attempting to connect to MQTT broker...", "info", 2000);
    appState.mqttConnectAttempts++;

    const mqttWsPort = appState.config.mqttWsPort || 8887; 

    const mqttBrokerUrl = `ws://${window.location.hostname}:${mqttWsPort}`;

    const clientId = `chorecast_frontend_${Math.random().toString(16).substr(2, 8)}`;

    if (typeof mqtt === 'undefined') {
        console.error("MQTT.js library not loaded. Cannot connect to broker.");
        showToast("MQTT library not found. Please check your network.", "error");
        return;
    }

    appState.mqttClient = mqtt.connect(mqttBrokerUrl, {
        clientId: clientId,
        clean: true, 

        reconnectPeriod: 0, 

        username: appState.user.username, 

        password: appState.user.token 

    });

    appState.mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker!');
        appState.isMqttConnected = true;
        appState.mqttConnectAttempts = 0; 

        showToast("Connected to MQTT broker.", "success");

        appState.mqttClient.subscribe('chorecast/reader/+/status', (err) => {
            if (!err) console.log("Subscribed to chorecast/reader/+/status");
            else console.error("Error subscribing to chorecast/reader/+/status:", err);
        });
        appState.mqttClient.subscribe('chorecast/feedback', (err) => { 

            if (!err) console.log("Subscribed to chorecast/feedback");
            else console.error("Error subscribing to chorecast/feedback:", err);
        });

        if (appState.user && appState.user.id) {
            appState.mqttClient.subscribe(`chorecast/user/${appState.user.id}/status`, (err) => {
                if (!err) console.log(`Subscribed to chorecast/user/${appState.user.id}/status`);
                else console.error(`Error subscribing to chorecast/user/${appState.user.id}/status:`, err);
            });
        }

        appState.mqttClient.subscribe('chorecast/updates/dashboard', (err) => {
            if (!err) console.log("Subscribed to chorecast/updates/dashboard");
            else console.error("Error subscribing to chorecast/updates/dashboard:", err);
        });
        appState.mqttClient.subscribe('chorecast/updates/statistics', (err) => {
            if (!err) console.log("Subscribed to chorecast/updates/statistics");
            else console.error("Error subscribing to chorecast/updates/statistics:", err);
        });
    });

    appState.mqttClient.on('reconnect', () => {
        console.log('Attempting to reconnect to MQTT broker...');
        showToast("Reconnecting to MQTT broker...", "info");
    });

    appState.mqttClient.on('error', (err) => {
        console.error('MQTT connection error:', err);
        appState.isMqttConnected = false;

        if (appState.mqttClient) appState.mqttClient.end();
        showToast("MQTT connection error. Retrying...", "error");
        setTimeout(connectMqtt, appState.mqttReconnectInterval); 

    });

    appState.mqttClient.on('close', () => {
        console.log('MQTT connection closed.');
        appState.isMqttConnected = false;

        if (appState.mqttConnectAttempts < appState.maxMqttConnectAttempts) {
            setTimeout(connectMqtt, appState.mqttReconnectInterval);
        }
    });

    appState.mqttClient.on('message', (topic, message) => {

        const payload = message.toString();

        try {
            const data = JSON.parse(payload);

            if (topic === 'chorecast/feedback' && data.type === 'tag_scan_modal_feedback' && appState.onNfcScanFeedback) {
                appState.onNfcScanFeedback(data); 

                return; 

            }

            if (topic.startsWith('chorecast/reader/') && topic.endsWith('/status')) {

                if (typeof data.isOnline === 'boolean') {

                    if (!appState.isTagScanModalActive && appState.onReaderStatusUpdate) {
                        appState.onReaderStatusUpdate(data);
                    } else if (appState.isTagScanModalActive) {
                        console.log("[MQTT Message] Suppressing general reader status update due to active tag scan modal.");
                    }
                }

                return; 

            }

            if (topic === 'chorecast/feedback') {

                if (appState.user && appState.user.isAdmin) {
                    if (data.type === 'chore_completed' && appState.onDashboardUpdated) {
                        appState.onDashboardUpdated(data); 

                        showToast(data.message, data.status === 'success' ? 'success' : 'error'); 

                    } else if (data.type === 'user_signed_in') {
                        appState.activeReaderSession = {
                            readerMacAddress: data.readerMacAddress,
                            userId: data.userId,
                            username: data.username
                        };
                        showToast(`Hey, ${data.username} signed in!`, 'success');
                    } else if (data.type === 'user_signed_out') {
                        const SIusername = appState.activeReaderSession.username;
						appState.activeReaderSession = null;
                        showToast(`OK, ${SIusername} signed out!`, 'success');
                    } else if (data.message) {

                        showToast(data.message, data.status === 'success' ? 'success' : 'error');
                    }
                }

                return; 

            }

            if (topic === 'chorecast/updates/dashboard' && appState.onDashboardUpdated) {
                appState.onDashboardUpdated(); 

                return;
            }
            if (topic === 'chorecast/updates/statistics' && appState.onStatisticsUpdated) {
                appState.onStatisticsUpdated(); 

                return;
            }

            if (appState.user && topic.startsWith(`chorecast/user/${appState.user.id}/status`)) {
                if (data.message) {
                    showToast(data.message, data.status === 'success' ? 'success' : 'error');
                }
                return; 

            }

        } catch (e) {
            console.error("Error parsing MQTT message payload:", e);
            showToast("Received unreadable MQTT message.", "error");
        }
    });
}

export function disconnectMqtt() {
    if (appState.mqttClient) {
        appState.mqttClient.end();
        appState.isMqttConnected = false;
        appState.mqttConnectAttempts = 0;
        console.log("Disconnected from MQTT broker.");
    }
}

export function loginUser(user, token) { 

    appState.user = {
        ...user,
        token,
        isAdmin: !!user.isAdmin 

    };
    localStorage.setItem('chorecastUser', JSON.stringify(appState.user));
    localStorage.setItem('chorecastToken', token); 

    api.setAuthToken(token); 

}

export function logoutUser() {
    appState.user = null;
    localStorage.removeItem('chorecastUser');
    localStorage.removeItem('chorecastToken'); 

    localStorage.removeItem('lastPage'); 

    api.clearAuthToken(); 

    disconnectMqtt(); 

    showToast('Logged out.', 'info');
    if (appState.onLogout) {
        appState.onLogout();
    }

}

export async function initiateTagScanInModal() { 

    const tagModal = appState.ui.tagScanModal; 

    const tagIdInput = appState.ui.tagIdInput; 

    const listenForTagBtn = appState.ui.listenForTagBtn; 

    const tagScanFeedback = appState.ui.tagScanFeedback; 

    if (!tagIdInput || !listenForTagBtn || !tagScanFeedback) {
        console.error("[AppCore Error] Missing tag scan modal UI elements. Ensure appState.ui is initialized.");
        showInfoModal('Tag Scan Error', 'Required UI elements for tag scanning not found. Please refresh.', 'error');
        return;
    }

    tagIdInput.value = 'Scanning...';
    tagIdInput.disabled = true; 

    listenForTagBtn.disabled = true; 

    listenForTagBtn.textContent = 'Scanning...'; 

    appState.isTagScanModalActive = true; 

    tagScanFeedback.textContent = 'Waiting for reader scan...';
    tagScanFeedback.style.color = 'blue';

    if (!appState.user || !appState.user.username || !appState.user.token) {
        console.error("Cannot initiate tag scan: User not logged in or missing credentials.");
        tagIdInput.value = 'Login Required';
        tagIdInput.disabled = false;
        listenForTagBtn.disabled = false;
        listenForTagBtn.textContent = 'Listen for Scan'; 

        appState.isTagScanModalActive = false; 

        tagScanFeedback.textContent = 'Login required to scan tags.';
        tagScanFeedback.style.color = 'red';
        showInfoModal('Authentication Error', 'You must be logged in to scan NFC tags.', 'error');
        return;
    }

    if (!appState.mqttClient || !appState.mqttClient.connected) {
        console.warn('[Tag Scan] MQTT client not connected. Attempting to connect before scan...');
        await connectMqtt(); 

        if (!appState.mqttClient || !appState.mqttClient.connected) {
            console.error('[Tag Scan] Failed to connect MQTT for tag scan.');
            tagIdInput.value = 'MQTT Conn Error';
            tagIdInput.disabled = false;
            listenForTagBtn.disabled = false;
            listenForTagBtn.textContent = 'Listen for Scan'; 

            appState.isTagScanModalActive = false; 

            tagScanFeedback.textContent = 'Failed to connect to MQTT.';
            tagScanFeedback.style.color = 'red';
            showInfoModal('MQTT Error', 'Failed to connect to MQTT broker for tag scanning. Please try again.', 'error');
            return;
        }
    }

    const readerMacAddress = appState.activeReaderSession ? appState.activeReaderSession.readerMacAddress : 'any'; 

    const scanCommandTopic = `chorecast/reader/${readerMacAddress}/scan_command`;
    const scanCommandPayload = JSON.stringify({
        command: 'start_scan', 

        userId: appState.user.id,
        username: appState.user.username,
        requestId: Date.now()
    });

    try {
        appState.mqttClient.publish(scanCommandTopic, scanCommandPayload, { qos: 1, retain: false }, (error) => {
            if (error) {
                console.error(`[MQTT Publish Error] Failed to publish scan command: ${error}`);
                showToast('Failed to send scan command to reader.', 'error');
                tagIdInput.value = 'Publish Error';
                tagIdInput.disabled = false;
                listenForTagBtn.disabled = false;
                listenForTagBtn.textContent = 'Listen for Scan'; 

                appState.isTagScanModalActive = false; 

                tagScanFeedback.textContent = 'Error sending scan command.';
                tagScanFeedback.style.color = 'red';
            } else {
                showToast('Ready to scan tag. Tap an NFC tag to a reader.', 'info', 5000);
            }
        });
    } catch (e) {
        console.error("Error publishing MQTT message:", e);
        showToast("Error initiating tag scan.", "error");
        tagIdInput.value = 'MQTT Error';
        tagIdInput.disabled = false;
        listenForTagBtn.disabled = false;
        listenForTagBtn.textContent = 'Listen for Scan'; 

        appState.isTagScanModalActive = false; 

        tagScanFeedback.textContent = 'Error initiating tag scan.';
        tagScanFeedback.style.color = 'red';
    }

    clearTimeout(appState.nfcScanFeedbackTimeout); 

    appState.nfcScanFeedbackTimeout = setTimeout(() => {
        if (appState.isTagScanModalActive) { 

            console.warn('[AppCore] NFC scan timed out. No feedback received.');

            if (appState.onNfcScanFeedback) {
                appState.onNfcScanFeedback({ status: 'error', message: 'NFC scan timed out. No tag detected or reader response.' });
            }

        }
    }, 15000); 

    appState.onNfcScanFeedback = (data) => {
        clearTimeout(appState.nfcScanFeedbackTimeout); 

        if (data.nfcTagId) {

            if (tagIdInput) tagIdInput.value = data.nfcTagId;
            if (tagScanFeedback) {
                tagScanFeedback.textContent = 'Tag scanned successfully!';
                tagScanFeedback.style.color = 'green';
            }
            showToast(`Tag scanned: ${data.nfcTagId}`, 'success');

            if (tagIdInput) tagIdInput.disabled = false; 
            if (listenForTagBtn) {
                listenForTagBtn.disabled = false;
                listenForTagBtn.textContent = 'Listen for Scan'; 

            }

            appState.onNfcScanFeedback = null; 
            appState.isTagScanModalActive = false; 
        } else {

            if (tagIdInput) tagIdInput.value = data.nfcTagId || ''; 

            if (tagScanFeedback) {
                tagScanFeedback.textContent = data.message || 'NFC scan feedback received.';
                tagScanFeedback.style.color = 'red';
            }
            showToast(data.message, 'error');

            appState.nfcScanFeedbackTimeout = setTimeout(() => {
                if (tagIdInput) tagIdInput.value = ''; 

                if (tagIdInput) tagIdInput.disabled = false;
                if (listenForTagBtn) {
                    listenForTagBtn.disabled = false;
                    listenForTagBtn.textContent = 'Listen for Scan';
                }
                if (tagScanFeedback) {
                    tagScanFeedback.textContent = 'Place an NFC tag on the reader.';
                    tagScanFeedback.style.color = 'black';
                }

                appState.onNfcScanFeedback = null; 
                appState.isTagScanModalActive = false; 
            }, 3000); 

        }
    };
}

export function closeTagModal() {

    const tagModal = appState.ui.tagScanModal;
    const tagIdInput = appState.ui.tagIdInput;
    const listenForTagBtn = appState.ui.listenForTagBtn;
    const tagScanFeedback = appState.ui.tagScanFeedback; 

    if (tagModal) {
        tagModal.classList.add('hidden');
        tagModal.classList.remove('is-visible');
    }

    if (tagIdInput) tagIdInput.value = '';
    if (listenForTagBtn) {
        listenForTagBtn.disabled = false;
        listenForTagBtn.textContent = 'Listen for Scan';
    }
    if (tagScanFeedback) { 

        tagScanFeedback.textContent = 'Place an NFC tag on the reader.';
        tagScanFeedback.style.color = 'black';
    }
    clearTimeout(appState.nfcScanFeedbackTimeout);
    appState.onNfcScanFeedback = null; 

    appState.isTagScanModalActive = false; 

}

export async function fetchAndStoreConfig() {
    try {
        const response = await api.getConfig();
        if (response.success) {
            appState.config = { ...appState.config, ...response.data }; 

        } else {
            console.error('[AppCore] Failed to load application config:', response.message);
            showToast('Failed to load application configuration.', 'error');
        }
    } catch (error) {
        console.error('[AppCore] Error fetching application config:', error);
        showToast('Error fetching application configuration.', 'error');
    }
}