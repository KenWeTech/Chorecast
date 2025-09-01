

import { appState, api, showInfoModal, hideLoadingOverlay, showLoadingOverlay, showToast, showConfirmModal, hideModal } from './app_core.js';

import { DateTime } from '../lib/luxon/luxon.min.js'; 

let completionChartInstance = null; 

function formatTime(timeString) {
    if (!timeString || timeString === 'N/A') return 'N/A';

    const useMilitaryTime = appState.settings && appState.settings.useMilitaryTime === 'true';
    const timezone = appState.config.timezone || 'America/New_York'; 

    try {

        const now = DateTime.local().setZone(timezone); 
        const [hours, minutes] = timeString.split(':').map(Number);
        const time = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });

        if (!time.isValid) {
            console.warn("Invalid time string for Luxon:", timeString, time.invalidExplanation);
            return timeString; 
        }

        if (useMilitaryTime) {
            return time.toFormat('HH:mm'); 
        } else {
            return time.toFormat('h:mm a'); 
        }
    } catch (e) {
        console.error("Error formatting time with Luxon:", timeString, e);
        return timeString; 
    }
}

function populateSelect(selectElement, items, defaultValue = '', placeholderText = '(None)') {
    if (!selectElement) {
        console.error("populateSelect: selectElement is null.");
        return;
    }
    selectElement.innerHTML = ''; 
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholderText;
    selectElement.appendChild(defaultOption);

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name || item.username; 
        if (String(item.id) === String(defaultValue)) { 
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

function populateMultiSelect(containerId, items, selectedValues = []) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Multi-select container with ID ${containerId} not found.`);
        return;
    }

    const display = container.querySelector('.selected-items-display');
    const dropdown = container.querySelector('.options-dropdown');

    if (!display || !dropdown) {
        console.error(`Multi-select display or dropdown not found within container ${containerId}.`);
        return;
    }

    dropdown.innerHTML = ''; 

    items.forEach(item => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.id;
        checkbox.checked = selectedValues.includes(item.id);
        checkbox.dataset.name = item.name || item.username; 

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(item.name || item.username));
        dropdown.appendChild(label);
    });

    updateMultiSelectDisplay(containerId);

    display.onclick = (e) => {
        e.stopPropagation(); 
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    };

    dropdown.onchange = () => updateMultiSelectDisplay(containerId);

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

function updateMultiSelectDisplay(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`updateMultiSelectDisplay: container with ID ${containerId} not found.`);
        return;
    }
    const display = container.querySelector('.selected-items-display');
    const checkboxes = container.querySelectorAll('.options-dropdown input[type="checkbox"]:checked');
    const selectedNames = Array.from(checkboxes).map(cb => cb.dataset.name);

    if (!display) {
        console.error(`updateMultiSelectDisplay: selected-items-display not found in container ${containerId}.`);
        return;
    }

    if (selectedNames.length === 0) {
        display.textContent = 'Select users...';
        display.classList.add('placeholder');
    } else {
        display.textContent = selectedNames.join(', ');
        display.classList.remove('placeholder');
    }
}

function getMultiSelectValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`getMultiSelectValues: container with ID ${containerId} not found.`);
        return [];
    }
    const checkboxes = container.querySelectorAll('.options-dropdown input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

export async function loadDashboard(state) {

    if (!state.user || !state.user.id) {
        console.error('[AppLogic][loadDashboard] Cannot load dashboard: appState.user is null or missing ID.');
        showInfoModal('Dashboard Load Error', 'User not logged in or session expired. Please log in again.', 'error');
        hideLoadingOverlay();
        return; 
    }

    const dashboardPage = document.getElementById('page-dashboard');
    if (dashboardPage) {
        dashboardPage.classList.remove('hidden');
        dashboardPage.classList.add('active'); 
        
        document.querySelectorAll('.page-content').forEach(page => {
            if (page.id !== 'page-dashboard') {
                page.classList.add('hidden');
                page.classList.remove('active'); 
            }
        });
    }

    const adminDashboardToggle = document.getElementById('admin-dashboard-toggle');
    const dashboardViewModeSelect = document.getElementById('dashboard-view-mode');

    if (state.user.isAdmin) {
        if (adminDashboardToggle) adminDashboardToggle.classList.remove('hidden');
        if (dashboardViewModeSelect) {
            dashboardViewModeSelect.value = state.dashboardViewMode; 
            
            if (!dashboardViewModeSelect.dataset.listenerAttached) {
                dashboardViewModeSelect.addEventListener('change', (event) => {
                    state.dashboardViewMode = event.target.value; 
					localStorage.setItem('dashboardViewMode', state.dashboardViewMode); 
                    loadDashboard(state); 
                });
                dashboardViewModeSelect.dataset.listenerAttached = 'true';
            }
        }
    } else {
        if (adminDashboardToggle) adminDashboardToggle.classList.add('hidden');
        state.dashboardViewMode = 'my_chores'; 
    }

    showLoadingOverlay();
    try {
        const dashboardData = await api.getDashboardData(state.user.id, state.dashboardViewMode);
        if (dashboardData.success) {

            const dashboardDueCount = document.getElementById('dashboard-due-count');
            const dashboardCompletedCount = document.getElementById('dashboard-completed-count');
            if (dashboardDueCount) dashboardDueCount.textContent = dashboardData.data.dueChoresToday.length;
            
            if (dashboardCompletedCount) dashboardCompletedCount.textContent = dashboardData.data.completedChoresToday.length;

            const uncompletedList = document.getElementById('uncompleted-chores-list');
			if (uncompletedList) {
				uncompletedList.innerHTML = ''; 

				let chores = dashboardData.data.dueChoresToday;

				if (chores.length > 0) {
					
					chores.sort((a, b) => {
						const getMinutes = t => {
							if (!t) return Infinity; 
							const [h, m] = t.split(':').map(Number);
							return h * 60 + m;
						};
						return getMinutes(a.time) - getMinutes(b.time);
					});

					chores.forEach(chore => {
						const li = document.createElement('li');
						li.classList.add('chore-item');
						const byUserText = (state.dashboardViewMode === 'all_chores' && chore.userName) ? ` | User: ${chore.userName}` : '';
						li.innerHTML = `
							<div>
								<p class="chore-name">${chore.choreName} <span class="chore-area">${chore.area ? `(${chore.area})` : ''}</span></p>
								<p class="chore-start-time">Time: ${chore.time ? formatTime(chore.time) : 'Any Time'}${byUserText}</p>
							</div>
							<span class="chore-duration">${chore.duration ? `${chore.duration} min` : ''}</span>
						`;
						uncompletedList.appendChild(li);
					});
				} else {
					uncompletedList.innerHTML = '<li>No uncompleted chores for today.</li>';
				}
			}

            const completedList = document.getElementById('completed-chores-list');
            const completedChoresHeading = document.getElementById('completed-chores-heading');
            if (completedList && completedChoresHeading) {
                completedList.innerHTML = ''; 
                if (dashboardData.data.completedChoresToday.length > 0) {
				completedChoresHeading.textContent = `Completed Chores (Today) - [${dashboardData.data.completedChoresToday.length}]`;
                    dashboardData.data.completedChoresToday.forEach(chore => {
                        const li = document.createElement('li');
                        li.classList.add('chore-item');
                        
                        const byUserText = (state.dashboardViewMode === 'all_chores' && chore.userName) ? ` by ${chore.userName}` : '';
                        const completionTime = chore.completedAt ? formatTime(DateTime.fromISO(chore.completedAt, { zone: state.config.timezone }).toFormat('HH:mm')) : 'N/A';

                        li.innerHTML = `
                            <div>
                                <p class="chore-name">${chore.choreName} <span class="chore-area">${chore.area ? `(${chore.area})` : ''}</span></p>
                                <p class="chore-start-time">Completed: ${completionTime}${byUserText}</p>
                            </div>
                            <span class="chore-duration">${chore.duration ? `${chore.duration} min` : ''}</span>
                        `;
                        completedList.appendChild(li);
                    });
                } else {
                    completedChoresHeading.textContent = 'Completed Chores (Today)';
                    completedList.innerHTML = '<li>No completed chores yet.</li>';
                }
            }

            updateReaderStatusDisplay(state);

        } else {
            showInfoModal('Dashboard Error', dashboardData.message, 'error');
        }
    } catch (error) {
        console.error("Error loading dashboard:", error);
        showInfoModal('Dashboard Load Error', `Failed to load dashboard data: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function updateReaderStatusDisplay(state) {
    
    if (!state.user || !state.user.id) {
        console.warn('[AppLogic][updateReaderStatusDisplay] Cannot update reader status: appState.user is null or missing ID.');
        
        const readerStatusElement = document.getElementById('connected-reader-status');
        const dashboardReaderName = document.getElementById('dashboard-reader-name');
        const dashboardReaderStatus = document.getElementById('dashboard-reader-status');
        const dashboardReaderMessage = document.getElementById('dashboard-reader-message');

        if (readerStatusElement) {
            readerStatusElement.textContent = 'Not Logged In';
            readerStatusElement.style.color = 'gray';
        }
        if (dashboardReaderName) dashboardReaderName.textContent = 'N/A';
        if (dashboardReaderStatus) {
            dashboardReaderStatus.textContent = 'Not Connected';
            dashboardReaderStatus.style.color = 'gray';
        }
        if (dashboardReaderMessage) dashboardReaderMessage.textContent = 'Please log in to see reader status.';
        return; 
    }

    const readerStatusElement = document.getElementById('connected-reader-status');
    const dashboardReaderName = document.getElementById('dashboard-reader-name');
    const dashboardReaderStatus = document.getElementById('dashboard-reader-status');
    const dashboardReaderMessage = document.getElementById('dashboard-reader-message');

    if (!readerStatusElement || !dashboardReaderName || !dashboardReaderStatus || !dashboardReaderMessage) {
        console.warn('[AppLogic] Reader status display elements not found.');
        return;
    }

    readerStatusElement.textContent = 'Checking status...';
    readerStatusElement.style.color = '#ccc';
    dashboardReaderName.textContent = 'Loading...';
    dashboardReaderStatus.textContent = 'Loading...';
    dashboardReaderMessage.textContent = '';

    try {
        const response = await api.getUserReaderStatus();
        if (response.success && response.data) {
            const { readerName, isOnline } = response.data;
            if (readerName) {
                readerStatusElement.textContent = `Connected: ${readerName} (${isOnline ? 'Online' : 'Offline'})`;
                readerStatusElement.style.color = isOnline ? 'lightgreen' : 'orange';

                dashboardReaderName.textContent = readerName;
                dashboardReaderStatus.textContent = isOnline ? 'Online' : 'Offline';
                dashboardReaderStatus.style.color = isOnline ? 'lightgreen' : 'orange';
                dashboardReaderMessage.textContent = isOnline ? 'Reader is connected and ready.' : 'Reader is offline. Chore tags cannot be scanned.';
            } else {
                readerStatusElement.textContent = 'Not Connected';
                readerStatusElement.style.color = 'yellow';

                dashboardReaderName.textContent = 'N/A';
                dashboardReaderStatus.textContent = 'Not Connected';
                dashboardReaderStatus.style.color = 'yellow';
                dashboardReaderMessage.textContent = 'No Chorecast Reader is currently assigned to you or connected.';
            }
        } else {
            console.error(`[AppLogic Error] Reader status load failed: ${response.message}`);
            readerStatusElement.textContent = 'Status Unavailable';
            readerStatusElement.style.color = 'red';

            dashboardReaderName.textContent = 'Error';
            dashboardReaderStatus.textContent = 'Unavailable';
            dashboardReaderStatus.style.color = 'red';
            dashboardReaderMessage.textContent = `Failed to load reader status: ${response.message}`;
        }
    } catch (error) {
        if (error.message.includes('Authentication failed')) { 
            console.warn('[AppLogic] Session expired error caught in updateReaderStatusDisplay. Modal already handled by API function.');
            readerStatusElement.textContent = 'Session Expired';
            readerStatusElement.style.color = 'red';
            dashboardReaderName.textContent = 'Session Expired';
            dashboardReaderStatus.textContent = 'N/A';
            dashboardReaderStatus.style.color = 'red';
            dashboardReaderMessage.textContent = 'Your session has expired. Please log in.';
        } else {
            console.error("Failed to fetch reader status:", error);
            readerStatusElement.textContent = 'Status Error';
            readerStatusElement.style.color = 'red';
            dashboardReaderName.textContent = 'Error';
            dashboardReaderStatus.textContent = 'Error';
            dashboardReaderStatus.style.color = 'red';
            dashboardReaderMessage.textContent = `Failed to fetch reader status: ${error.message}`;
        }
    }
}

export async function loadUsers(state) {
    showLoadingOverlay();
    try {
        if (!state.user || !state.user.isAdmin) {
            
            return;
        }
        const response = await api.getUsers();
        if (response.success && Array.isArray(response.data)) {
            state.users = response.data;
            renderUsersTable(state.users);
            addTableSorting('users-table-body', state.users, renderUsersTable);
            updateUserTableHeadersVisibility(appState.config.authMethod);

            const usersTableBody = document.getElementById('users-table-body');
            if (usersTableBody && !usersTableBody.dataset.listenerAttached) {
                usersTableBody.addEventListener('click', (e) => {
                    const button = e.target.closest('button');
                    if (!button) return;

                    const userId = button.dataset.id;
                    if (button.classList.contains('edit-user-btn')) {
                        openUserModal(state, userId);
                    } else if (button.classList.contains('delete-user-btn')) {
                        deleteUser(state, userId);
                    }
                });
                usersTableBody.dataset.listenerAttached = 'true';
            }
            
        } else {
            showInfoModal('User Load Error', response.message || 'Failed to load users.', 'error');
        }
    } catch (error) {
        console.error("Error loading users:", error);
        showInfoModal('User Load Error', `Failed to load users: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function openUserModal(state, userId = null) {
    const userModal = document.getElementById('user-modal');
    const userForm = document.getElementById('user-form');
    const userIdInput = document.getElementById('user-id');
    const usernameInput = document.getElementById('user-username');
    const passwordInput = document.getElementById('user-password');
    const isAdminCheckbox = document.getElementById('user-isAdmin');
    const enabledCheckbox = document.getElementById('user-enabled');
    const nfcTagIdField = userModal ? userModal.querySelector('.nfc-tag-id-field') : null; 
    const assignedReaderIdField = userModal ? userModal.querySelector('.assigned-reader-id-field') : null; 
    const nfcTagIdSelect = document.getElementById('user-nfc-tag-id');
    const assignedReaderIdSelect = document.getElementById('user-assigned-reader-id');
    const userModalTitle = document.querySelector('#user-modal h2');

    if (!userModal || !userForm || !userIdInput || !usernameInput || !passwordInput || !isAdminCheckbox || !enabledCheckbox || !userModalTitle) {
        console.error("User modal elements not found.");
        showInfoModal('User Modal Error', 'Required UI elements for user modal not found.', 'error');
        return;
    }

    if (!state.tags || state.tags.length === 0) {
        const tagsResponse = await api.getTags();
        if (tagsResponse.success) {
            state.tags = tagsResponse.data;
        } else {
            showInfoModal('Data Load Error', 'Could not load required NFC Tag data. Please try again.', 'error');
            return; 
        }
    }

    userForm.reset();
    userIdInput.value = '';
    passwordInput.placeholder = 'Enter password'; 
    isAdminCheckbox.checked = false;
    enabledCheckbox.checked = true; 
    userModalTitle.textContent = 'Add New User';

    if (appState.config.authMethod === 'user_tag_signin') {
        if (nfcTagIdField) nfcTagIdField.style.display = 'block';
        if (assignedReaderIdField) assignedReaderIdField.style.display = 'none';
        if (nfcTagIdSelect) await loadNfcTagsForUserDropdown(nfcTagIdSelect); 
    } else if (appState.config.authMethod === 'reader_assigned') {
        if (nfcTagIdField) nfcTagIdField.style.display = 'none';
        if (assignedReaderIdField) assignedReaderIdField.style.display = 'block';
        if (assignedReaderIdSelect) await loadNfcReadersForUserDropdown(assignedReaderIdSelect); 
    } else {
        
        if (nfcTagIdField) nfcTagIdField.style.display = 'none';
        if (assignedReaderIdField) assignedReaderIdField.style.display = 'none';
    }

    if (userId) {
        showLoadingOverlay();
        try {
            const response = await api.getUsers();

            if (response.success && Array.isArray(response.data)) {
                const user = response.data.find(u => u.id == userId); 
                if (user) {
                    userModalTitle.textContent = 'Edit User';
                    userIdInput.value = user.id;
                    usernameInput.value = user.username;
                    isAdminCheckbox.checked = user.isAdmin;
                    enabledCheckbox.checked = user.enabled;
                    passwordInput.placeholder = 'Leave blank to keep current password'; 

                    if (appState.config.authMethod === 'user_tag_signin' && user.nfcTagId) {
                        const assignedTag = state.tags.find(tag => tag.tagId === user.nfcTagId);
                        
                        if (nfcTagIdSelect) nfcTagIdSelect.value = assignedTag ? assignedTag.id : '';
                    } else if (appState.config.authMethod === 'reader_assigned' && user.assignedReaderId) {
                        
                        if (assignedReaderIdSelect) assignedReaderIdSelect.value = user.assignedReaderId;
                    } else {
                        
                        if (nfcTagIdSelect) nfcTagIdSelect.value = '';
                        if (assignedReaderIdSelect) assignedReaderIdSelect.value = '';
                    }

                } else {
                    showInfoModal('Error', 'User not found for editing.', 'error');
                    return;
                }
            } else {
                console.error('[AppLogic][openUserModal] Failed to fetch users for edit modal: Invalid data or API error.', response.message, response.data);
                showInfoModal('Error', response.message || 'Failed to load users for edit: Invalid data received.', 'error');
                return; 
            }
        } catch (error) {
            console.error("Error fetching user for edit:", error);
            showInfoModal('Error', `Failed to load user data: ${error.message}`, 'error');
            return; 
        } finally {
            hideLoadingOverlay();
        }
    }

    userModal.classList.remove('hidden');
    userModal.classList.add('is-visible');
}

export async function saveUser(event, state) {
    event.preventDefault();
    showLoadingOverlay();

    const userId = document.getElementById('user-id') ? document.getElementById('user-id').value : '';
    const username = document.getElementById('user-username') ? document.getElementById('user-username').value : '';
    const password = document.getElementById('user-password') ? document.getElementById('user-password').value : '';
    const isAdmin = document.getElementById('user-isAdmin') ? document.getElementById('user-isAdmin').checked : false;
    const enabled = document.getElementById('user-enabled') ? document.getElementById('user-enabled').checked : false;

    let nfcTagId = null;
    let assignedReaderId = null;

    if (appState.config.authMethod === 'user_tag_signin') {
        const nfcTagIdElement = document.getElementById('user-nfc-tag-id');
        if (nfcTagIdElement) nfcTagId = nfcTagIdElement.value || null;
    } else if (appState.config.authMethod === 'reader_assigned') {
        const assignedReaderIdElement = document.getElementById('user-assigned-reader-id');
        if (assignedReaderIdElement) assignedReaderId = assignedReaderIdElement.value || null;
    }

    const userData = { username, isAdmin, enabled, nfcTagId, assignedReaderId };
    if (password) { 
        userData.password = password;
    }

    try {
        let response;
        if (userId) {
            response = await api.updateUser(userId, userData);
        } else {
            response = await api.createUser(userData);
        }

        if (response.success) {
            showToast(response.message, 'success'); 
            hideModal('user-modal');
            
            if (state.user && state.user.isAdmin) {
                await loadUsers(state); 
            }
        } else {
            showInfoModal('Save User Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error saving user:", error);
        showInfoModal('Save User Error', `Failed to save user: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function deleteUser(state, userId) {
    const confirmed = await showConfirmModal('Delete User', 'Are you sure you want to delete this user? This action cannot be undone.');
    if (!confirmed) return;

    showLoadingOverlay();
    try {
        const response = await api.deleteUser(userId);
        if (response.success) {
            showToast(response.message, 'success');
            
            if (state.user && state.user.isAdmin) {
                await loadUsers(state); 
            }
        } else {
            showInfoModal('Delete User Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error deleting user:", error);
        showInfoModal('Delete User Error', `Failed to delete user: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function loadChores(state) {
    showLoadingOverlay();
    try {
        if (!Array.isArray(state.users) || state.users.length === 0 && state.user.isAdmin) {
            const usersResponse = await api.getUsers();
            if (usersResponse.success) state.users = usersResponse.data;
        }
        if (!state.tags || state.tags.length === 0) {
            const tagsResponse = await api.getTags();
            if (tagsResponse.success) state.tags = tagsResponse.data;
        }

        const response = await api.getChores();
        if (response.success) {
            state.chores = response.data;
            renderChoresTable(state.chores);
            addTableSorting('chores-table-body', state.chores, renderChoresTable);

            const choresTableBody = document.getElementById('chores-table-body');
            if (choresTableBody && !choresTableBody.dataset.listenerAttached) {
                choresTableBody.addEventListener('click', (e) => {
                    const button = e.target.closest('button');
                    if (!button) return;

                    const choreId = button.dataset.id;
                    if (button.classList.contains('edit-chore-btn')) {
                        openChoreModal(state, choreId);
                    } else if (button.classList.contains('delete-chore-btn')) {
                        deleteChore(state, choreId);
                    }
                });
                choresTableBody.dataset.listenerAttached = 'true';
            }
            
        } else {
            showInfoModal('Chore Load Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error loading chores:", error);
        showInfoModal('Chore Load Error', `Failed to load chores: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function openChoreModal(state, choreId = null) {
    const choreModal = document.getElementById('chore-modal');
    const choreForm = document.getElementById('chore-form');
    const choreIdInput = document.getElementById('chore-id');
    const choreNameInput = document.getElementById('chore-name');
    const choreDescriptionInput = document.getElementById('chore-description');
    const choreAreaInput = document.getElementById('chore-area');
    const choreDurationInput = document.getElementById('chore-duration');
    const choreNfcTagIdSelect = document.getElementById('chore-nfc-tag-id');
    const choreImportantCheckbox = document.getElementById('chore-important');
    const choreEnabledCheckbox = document.getElementById('chore-enabled');
    const choreAssignmentTypeSelect = document.getElementById('chore-assignment-type');
    const choreSchedulesContainer = document.getElementById('chore-schedules-container');
    const addScheduleBtn = document.getElementById('add-schedule-btn');
    const assignedUserPoolSelect = document.getElementById('chore-assigned-user-pool-custom-select');
    const choreModalTitle = document.querySelector('#chore-modal h2');

    if (!choreModal || !choreForm || !choreIdInput || !assignedUserPoolSelect || !choreModalTitle) {
        console.error("Chore modal elements not found.");
        return;
    }

    choreForm.reset();
    choreIdInput.value = '';
    choreEnabledCheckbox.checked = true;
    choreSchedulesContainer.innerHTML = '';
    choreModalTitle.textContent = 'Add New Chore';

    assignedUserPoolSelect.dataset.selectedIds = '[]';

    await loadNfcTagsForChoreDropdown(choreNfcTagIdSelect);
    
    await loadUsersForChorePool(assignedUserPoolSelect); 

    updateCustomMultiSelectDisplay(assignedUserPoolSelect, state.users);

    toggleAssignmentTypeUI('manual', choreSchedulesContainer, state.users, assignedUserPoolSelect);

    if (!choreId) {
        addScheduleInput(choreSchedulesContainer, state.users, 'manual');
    }

    addScheduleBtn.onclick = () => addScheduleInput(choreSchedulesContainer, state.users, choreAssignmentTypeSelect.value);
    choreAssignmentTypeSelect.onchange = () => toggleAssignmentTypeUI(choreAssignmentTypeSelect.value, choreSchedulesContainer, state.users, assignedUserPoolSelect);

    if (choreId) {
        showLoadingOverlay();
        try {
            const response = await api.getChoreDetails(choreId);
            if (response.success && response.data) {
                const chore = response.data;
                choreModalTitle.textContent = 'Edit Chore';
                choreIdInput.value = chore.id;
                choreNameInput.value = chore.name;
                choreDescriptionInput.value = chore.description;
                choreAreaInput.value = chore.area;
                choreDurationInput.value = chore.duration;
                choreImportantCheckbox.checked = chore.important;
                choreEnabledCheckbox.checked = chore.enabled;
                choreAssignmentTypeSelect.value = chore.assignmentType;

                const assignedTag = state.tags.find(tag => tag.tagId === chore.nfcTagId);
                choreNfcTagIdSelect.value = assignedTag ? assignedTag.id : '';

                choreSchedulesContainer.innerHTML = '';
                if (chore.schedules && chore.schedules.length > 0) {
                    chore.schedules.forEach(schedule => addScheduleInput(choreSchedulesContainer, state.users, chore.assignmentType, schedule));
                } else {
                    addScheduleInput(choreSchedulesContainer, state.users, chore.assignmentType);
                }

                if (chore.assignmentType !== 'manual' && chore.assignedUsers) {
                    const selectedUserIds = chore.assignedUsers.map(u => u.id);
                    
                    assignedUserPoolSelect.dataset.selectedIds = JSON.stringify(selectedUserIds);
                    updateCustomMultiSelectDisplay(assignedUserPoolSelect, state.users);
                    
                }
                
                toggleAssignmentTypeUI(chore.assignmentType, choreSchedulesContainer, state.users, assignedUserPoolSelect);

            } else {
                showInfoModal('Error', response.message, 'error');
                return;
            }
        } catch (error) {
            showInfoModal('Error', `Failed to load chore data: ${error.message}`, 'error');
            return;
        } finally {
            hideLoadingOverlay();
        }
    }

    choreModal.classList.remove('hidden');
    choreModal.classList.add('is-visible');
}

export async function saveChore(event, state) {
    event.preventDefault();
    showLoadingOverlay();

    const choreId = document.getElementById('chore-id') ? document.getElementById('chore-id').value : '';
    const name = document.getElementById('chore-name') ? document.getElementById('chore-name').value : '';
    const description = document.getElementById('chore-description') ? document.getElementById('chore-description').value : '';
    const area = document.getElementById('chore-area') ? document.getElementById('chore-area').value : '';
    const duration = document.getElementById('chore-duration') ? document.getElementById('chore-duration').value : '';
    const nfcTagIdElement = document.getElementById('chore-nfc-tag-id');
    const nfcTagId = nfcTagIdElement ? nfcTagIdElement.value || null : null;
    const important = document.getElementById('chore-important') ? document.getElementById('chore-important').checked : false;
    const enabled = document.getElementById('chore-enabled') ? document.getElementById('chore-enabled').checked : false;
    const assignmentType = document.getElementById('chore-assignment-type') ? document.getElementById('chore-assignment-type').value : 'manual';

    const schedules = [];
    document.querySelectorAll('.schedule-input-block').forEach(block => {
        const scheduleType = block.querySelector('[name="scheduleType"]') ? block.querySelector('[name="scheduleType"]').value : '';
        const specificDateInput = block.querySelector('[name="specificDate"]');
        const specificDate = specificDateInput ? specificDateInput.value : null;
        const daysOfWeekCheckboxes = block.querySelectorAll('input[name="daysOfWeek"]:checked');
        const daysOfWeek = Array.from(daysOfWeekCheckboxes).map(cb => cb.value).join(',');
        const timeInput = block.querySelector('[name="time"]');
        const time = timeInput ? timeInput.value : null;
        const assignedUserIdInput = block.querySelector('[name="assignedUserId"]');
        const assignedUserId = assignedUserIdInput ? assignedUserIdInput.value : null;

        if (scheduleType === 'once' && !specificDate) {
            showInfoModal('Validation Error', 'Specific Date is required for "Once" schedule type.', 'warning');
            hideLoadingOverlay();
            throw new Error('Validation failed');
        }
        if (scheduleType === 'weekly' && !daysOfWeek) {
            showInfoModal('Validation Error', 'At least one Day of Week is required for "Weekly" schedule type.', 'warning');
            hideLoadingOverlay();
            throw new Error('Validation failed');
        }
        if (assignmentType === 'manual' && scheduleType !== 'daily' && !assignedUserId) {
             showInfoModal('Validation Error', 'Assigned User is required for manual assignment type schedules (unless daily).', 'warning');
             hideLoadingOverlay();
             throw new Error('Validation failed');
        }

        schedules.push({ scheduleType, specificDate, daysOfWeek, time, assignedUserId: assignedUserId ? parseInt(assignedUserId) : null });
    });

    let assignedUsers = [];
    if (assignmentType !== 'manual') {
        const userPoolElement = document.getElementById('chore-assigned-user-pool-custom-select');
        if (userPoolElement) {
            assignedUsers = JSON.parse(userPoolElement.dataset.selectedIds || '[]');
        }

        if (assignedUsers.length === 0) {
            showInfoModal('Validation Error', 'At least one user must be assigned to the pool for "Round Robin" or "Shuffle" assignment types.', 'warning');
            hideLoadingOverlay();
            return;
        }
    }

    const choreData = {
        name, description, area, duration, nfcTagId, important, enabled, assignmentType,
        schedules,
        assignedUsers
    };

    try {
        let response;
        if (choreId) {
            response = await api.updateChore(choreId, choreData);
        } else {
            response = await api.createChore(choreData);
        }

        if (response.success) {
            showToast(response.message, 'success');
            hideModal('chore-modal');
            await loadChores(state);
        } else {
            showInfoModal('Save Chore Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error saving chore:", error);
        showInfoModal('Save Chore Error', `Failed to save chore: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function deleteChore(state, choreId) {
    const confirmed = await showConfirmModal('Delete Chore', 'Are you sure you want to delete this chore? This will also delete its schedules and log entries. This action cannot be undone.');
    if (!confirmed) return;

    showLoadingOverlay();
    try {
        const response = await api.deleteChore(choreId);
        if (response.success) {
            showToast(response.message, 'success');
            await loadChores(state);
        } else {
            showInfoModal('Delete Chore Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error deleting chore:", error);
        showInfoModal('Delete Chore Error', `Failed to delete chore: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function loadTags(state) {
    showLoadingOverlay();
    try {
        const response = await api.getTags();
        if (response.success) {
            state.tags = response.data;
            renderTagsTable(state.tags);
            addTableSorting('tags-table-body', state.tags, renderTagsTable);

            const tagsTableBody = document.getElementById('tags-table-body');
            if (tagsTableBody && !tagsTableBody.dataset.listenerAttached) {
                tagsTableBody.addEventListener('click', (e) => {
                    const button = e.target.closest('button');
                    if (!button) return;
                    
                    const tagId = button.dataset.id;
                    if (button.classList.contains('edit-tag-btn')) {
                        openTagModal(state, tagId);
                    } else if (button.classList.contains('delete-tag-btn')) {
                        deleteTag(state, tagId);
                    }
                });
                tagsTableBody.dataset.listenerAttached = 'true';
            }
            
        } else {
            showInfoModal('Tag Load Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error loading tags:", error);
        showInfoModal('Tag Load Error', `Failed to load tags: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function openTagModal(appState, tagDbId = null, nfcTagIdFromTable = null) {
    const tagModal = document.getElementById('tag-modal');
    const tagForm = document.getElementById('tag-form');
    const tagDbIdInput = document.getElementById('tag-db-id');
    const tagIdInput = document.getElementById('tag-id-input');
    const tagNameInput = document.getElementById('tag-name-input');
    const tagTypeSelect = document.getElementById('tag-type-select');
    const listenForTagBtn = document.getElementById('listen-for-tag-btn');
    const tagScanFeedback = document.getElementById('tag-scan-feedback');
    const tagModalTitle = document.querySelector('#tag-modal h2');

    if (!tagModal || !tagForm || !tagDbIdInput || !tagIdInput || !tagNameInput || !tagTypeSelect ||
        !listenForTagBtn || !tagScanFeedback || !tagModalTitle) {
        console.error("Tag modal elements not found.");
        showInfoModal('Tag Modal Error', 'Required UI elements for tag modal not found.', 'error');
        return;
    }

    tagForm.reset();
    tagDbIdInput.value = '';
    tagIdInput.value = '';
    tagNameInput.value = '';
    tagTypeSelect.value = 'chore';
    tagModalTitle.textContent = 'Add New Tag';

    tagIdInput.disabled = false;
    listenForTagBtn.textContent = 'Listen for Scan';
    listenForTagBtn.disabled = false;
    listenForTagBtn.style.display = 'inline-block';
    tagScanFeedback.textContent = 'Place an NFC tag on the reader.';
    tagScanFeedback.style.color = 'black';
    tagScanFeedback.style.display = 'block';

    if (tagDbId) {
        showLoadingOverlay();
        try {
            const response = await api.getTags();
            if (response.success && Array.isArray(response.data)) {
                const tag = response.data.find(t => t.id == tagDbId);
                if (tag) {
                    tagModalTitle.textContent = 'Edit Tag';
                    tagDbIdInput.value = tag.id;
                    tagIdInput.value = tag.tagId;
                    tagNameInput.value = tag.name;
                    tagTypeSelect.value = tag.type;
                    tagIdInput.disabled = true;
                    listenForTagBtn.style.display = 'none';
                    tagScanFeedback.style.display = 'none';
                } else {
                    showInfoModal('Error', 'Tag not found for editing.', 'error');
                    return;
                }
            } else {
                console.error('[AppLogic][openTagModal] Failed to fetch tags for edit modal: Invalid data or API error.', response.message, response.data);
                showInfoModal('Error', response.message || 'Failed to load tags for edit: Invalid data received.', 'error');
                return;
            }
        } catch (error) {
            console.error("Error fetching tag for edit:", error);
            showInfoModal('Error', `Failed to load tag data: ${error.message}`, 'error');
            return;
        } finally {
            hideLoadingOverlay();
        }
    }

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
                tagScanFeedback.textContent = data.message || 'Tag scan feedback received.';
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

    const tagModalCloseButton = document.getElementById('tag-modal-close-button');
    const tagModalXButton = document.getElementById('tag-modal-x-button');
    if (tagModalCloseButton) tagModalCloseButton.onclick = () => hideModal('tag-modal');
    if (tagModalXButton) tagModalXButton.onclick = () => hideModal('tag-modal');

    tagModal.classList.remove('hidden');
    tagModal.classList.add('is-visible');
}

export async function saveTag(event, state) {
    event.preventDefault();
    showLoadingOverlay();

    const tagDbIdInput = document.getElementById('tag-db-id');
    const tagIdInput = document.getElementById('tag-id-input');
    const tagNameInput = document.getElementById('tag-name-input');
    const tagTypeSelect = document.getElementById('tag-type-select');

    if (!tagDbIdInput || !tagIdInput || !tagNameInput || !tagTypeSelect) {
        console.error("Save tag: Required UI elements not found.");
        showInfoModal('Save Tag Error', 'Required UI elements for saving tag not found.', 'error');
        hideLoadingOverlay();
        return;
    }

    const wasTagIdInputDisabled = tagIdInput.disabled;
    const wasTagNameInputDisabled = tagNameInput.disabled;
    const wasTagTypeSelectDisabled = tagTypeSelect.disabled;

    if (wasTagIdInputDisabled) tagIdInput.disabled = false;
    if (wasTagNameInputDisabled) tagNameInput.disabled = false;
    if (wasTagTypeSelectDisabled) tagTypeSelect.disabled = false;

    const nfcTagId = tagIdInput.value;
    const name = tagNameInput.value;
    const type = tagTypeSelect.value;

    if (wasTagIdInputDisabled) tagIdInput.disabled = true;
    if (wasTagNameInputDisabled) tagNameInput.disabled = true;
    if (wasTagTypeSelectDisabled) tagTypeSelect.disabled = true;

    if (!nfcTagId || !name || !type) {
        showInfoModal('Validation Error', 'Tag ID, Friendly Name, and Type cannot be empty.', 'warning');
        hideLoadingOverlay();
        return;
    }

    const tagData = { nfcTagId, name, type };

    try {
        let response;
        if (tagDbIdInput.value) {
            response = await api.updateTag(tagDbIdInput.value, tagData);
        } else {
            response = await api.createTag(tagData);
        }

        if (response.success) {
            showToast(response.message, 'success');
            hideModal('tag-modal');
            await loadTags(state);
            if (state.user && state.user.isAdmin) {
                await loadUsers(state);
            }
            await loadChores(state);
            await loadSettings(state);
        } else {
            showInfoModal('Save Tag Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error saving tag:", error);
        showInfoModal('Save Tag Error', `Failed to save tag: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function deleteTag(state, tagId) {
    const confirmed = await showConfirmModal('Delete Tag', 'Are you sure you want to delete this tag? This action cannot be undone.');
    if (!confirmed) return;

    showLoadingOverlay();
    try {
        const response = await api.deleteTag(tagId);
        if (response.success) {
            showToast(response.message, 'success');
            await loadTags(state);
            if (state.user && state.user.isAdmin) {
                await loadUsers(state);
            }
            await loadChores(state);
            await loadSettings(state);
        } else {
            showInfoModal('Delete Tag Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error deleting tag:", error);
        showInfoModal('Delete Tag Error', `Failed to delete tag: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function loadReaders(state) {
    showLoadingOverlay();
    try {
        const response = await api.getReaders();
        if (response.success) {
            state.readers = response.data;
            renderReadersTable(state.readers);
            addTableSorting('readers-table-body', state.readers, renderReadersTable);

            const readersTableBody = document.getElementById('readers-table-body');
            if (readersTableBody && !readersTableBody.dataset.listenerAttached) {
                readersTableBody.addEventListener('click', (e) => {
                    const button = e.target.closest('button');
                    if (!button) return;

                    const readerId = button.dataset.id;
                    if (button.classList.contains('edit-reader-btn')) {
                        openReaderModal(readerId, button.dataset.mac, button.dataset.name);
                    } else if (button.classList.contains('delete-reader-btn')) {
                        deleteReader(state, readerId);
                    }
                });
                readersTableBody.dataset.listenerAttached = 'true';
            }
            
        } else {
            showInfoModal('Reader Load Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error loading readers:", error);
        showInfoModal('Reader Load Error', `Failed to load readers: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function openReaderModal(readerId, macAddress, name) {
    const readerModal = document.getElementById('reader-modal');
    const readerForm = document.getElementById('reader-form');
    const readerMacAddressInput = document.getElementById('reader-mac-address');
    const readerNameInput = document.getElementById('reader-name-input');

    if (!readerModal || !readerForm || !readerMacAddressInput || !readerNameInput) {
        console.error("Reader modal elements not found.");
        showInfoModal('Reader Modal Error', 'Required UI elements for reader modal not found.', 'error');
        return;
    }

    readerForm.reset();
    readerMacAddressInput.value = macAddress;
    readerNameInput.value = name;
    
    readerForm.onsubmit = async (event) => {
        event.preventDefault();
        showLoadingOverlay();
        const newName = readerNameInput.value;
        try {
            const response = await api.updateReaderName(macAddress, newName);
            if (response.success) {
                showToast(response.message, 'success');
                hideModal('reader-modal');
                await loadReaders(appState);
            } else {
                showInfoModal('Save Reader Name Failed', response.message, 'error');
            }
        } catch (error) {
            console.error("Error saving reader name:", error);
            showInfoModal('Save Reader Name Error', `Failed to save reader name: ${error.message}`, 'error');
        } finally {
            hideLoadingOverlay();
        }
    };

    readerModal.classList.remove('hidden');
    readerModal.classList.add('is-visible');
}

export async function deleteReader(state, readerId) {
    const confirmed = await showConfirmModal('Delete Chorecast Reader', 'Are you sure you want to delete this Chorecast Reader? This action cannot be undone. If online, the device will factory reset. ');
    if (!confirmed) return;

    showLoadingOverlay();
    try {
        const response = await api.deleteReader(readerId);
        if (response.success) {
            showToast(response.message, 'success');
            await loadReaders(state);
            if (state.user && state.user.isAdmin) {
                await loadUsers(state);
            }
            await updateReaderStatusDisplay(state);
        } else {
            showInfoModal('Delete Reader Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error deleting reader:", error);
        showInfoModal('Delete Reader Error', `Failed to delete reader: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function loadSettings(state) {
    showLoadingOverlay();
    try {
        const response = await api.getSettings();
        if (response.success) {
            const settings = response.data;
            state.settings = settings;

            const authMethodElement = document.getElementById('authMethod');
            if (authMethodElement) authMethodElement.value = settings.authMethod || 'reader_assigned';
            const nudgrWebhookUrlElement = document.getElementById('nudgrWebhookUrl');
            if (nudgrWebhookUrlElement) nudgrWebhookUrlElement.value = settings.nudgrWebhookUrl || '';
            const nudgrApiKeyElement = document.getElementById('nudgrApiKey');
            if (nudgrApiKeyElement) nudgrApiKeyElement.value = settings.nudgrApiKey || '';
            const nudgrOnMissedElement = document.getElementById('nudgrOnMissed');
            if (nudgrOnMissedElement) nudgrOnMissedElement.checked = settings.nudgrOnMissed === 'true';
            const nudgrOnImportantElement = document.getElementById('nudgrOnImportant');
            if (nudgrOnImportantElement) nudgrOnImportantElement.checked = settings.nudgrOnImportant === 'true';
            const nudgrAlertLeadTimeElement = document.getElementById('nudgrAlertLeadTime');
            if (nudgrAlertLeadTimeElement) nudgrAlertLeadTimeElement.value = settings.nudgrAlertLeadTime || '5_minutes';
            const nudgrIsRelentlessElement = document.getElementById('nudgrIsRelentless');
            if (nudgrIsRelentlessElement) nudgrIsRelentlessElement.checked = settings.nudgrIsRelentless === 'true';
            const haWebhookUrlElement = document.getElementById('haWebhookUrl');
            if (haWebhookUrlElement) haWebhookUrlElement.value = settings.haWebhookUrl || '';
            const useMilitaryTimeElement = document.getElementById('useMilitaryTime');
            if (useMilitaryTimeElement) useMilitaryTimeElement.checked = settings.useMilitaryTime === 'true';
			
			const clearMacBansBtn = document.getElementById('clearMacBansBtn');
			if (clearMacBansBtn) {
            clearMacBansBtn.onclick = handleClearMacBans;
			}

            const signOutTagSelect = document.getElementById('signOutTagId');
            if (signOutTagSelect) {
                await loadNfcTagsForSettingDropdown(signOutTagSelect, 'sign_out');
                signOutTagSelect.value = settings.signOutTagId || '';
            }

            const clearStatsUserSelect = document.getElementById('clear-stats-user');
            const clearStatsBtn = document.getElementById('clear-stats-btn');

            if (clearStatsUserSelect && clearStatsBtn) {
                clearStatsUserSelect.innerHTML = '<option value="all">All Users</option>';
                if (state.users && state.users.length > 0) {
                    state.users.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = user.username;
                        clearStatsUserSelect.appendChild(option);
                    });
                }
                clearStatsBtn.onclick = handleClearStatistics;
            }
			
			showToast('Settings loaded.', 'info');
            updateUserTableHeadersVisibility(settings.authMethod);
        } else {
            showInfoModal('Settings Load Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error loading settings:", error);
        showInfoModal('Settings Load Error', `Failed to load settings: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function saveSettings(event, state) {
    event.preventDefault();
    showLoadingOverlay();

    const authMethodElement = document.getElementById('authMethod');
    const nudgrWebhookUrlElement = document.getElementById('nudgrWebhookUrl');
    const nudgrApiKeyElement = document.getElementById('nudgrApiKey');
    const nudgrOnMissedElement = document.getElementById('nudgrOnMissed');
    const nudgrOnImportantElement = document.getElementById('nudgrOnImportant');
    const nudgrAlertLeadTimeElement = document.getElementById('nudgrAlertLeadTime');
    const nudgrIsRelentlessElement = document.getElementById('nudgrIsRelentless');
    const signOutTagIdElement = document.getElementById('signOutTagId');
    const haWebhookUrlElement = document.getElementById('haWebhookUrl');
    const useMilitaryTimeElement = document.getElementById('useMilitaryTime');

    const settingsData = {
        authMethod: authMethodElement ? authMethodElement.value : 'reader_assigned',
        nudgrWebhookUrl: nudgrWebhookUrlElement ? nudgrWebhookUrlElement.value : 'http://mynudgr.local:6000',
        nudgrApiKey: nudgrApiKeyElement ? nudgrApiKeyElement.value : '',
        nudgrOnMissed: nudgrOnMissedElement ? nudgrOnMissedElement.checked.toString() : 'false',
        nudgrOnImportant: nudgrOnImportantElement ? nudgrOnImportantElement.checked.toString() : 'false',
        nudgrAlertLeadTime: nudgrAlertLeadTimeElement ? nudgrAlertLeadTimeElement.value : '5_minutes',
        nudgrIsRelentless: nudgrIsRelentlessElement ? nudgrIsRelentlessElement.checked.toString() : 'false',
        signOutTagId: signOutTagIdElement ? signOutTagIdElement.value || '' : '',
        haWebhookUrl: haWebhookUrlElement ? haWebhookUrlElement.value : '',
        useMilitaryTime: useMilitaryTimeElement ? useMilitaryTimeElement.checked.toString() : 'false'
    };

    try {
        const response = await api.saveSettings(settingsData);
        if (response.success) {
            showToast(response.message, 'success');
            state.settings = settingsData;
            if (state.onSettingsUpdated) {
                state.onSettingsUpdated();
            }
            updateUserTableHeadersVisibility(settingsData.authMethod);
        } else {
            showInfoModal('Save Settings Failed', response.message, 'error');
        }
    } catch (error) {
        console.error("Error saving settings:", error);
        showInfoModal('Save Settings Error', `Failed to save settings: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

async function handleClearStatistics() {
    const userId = document.getElementById('clear-stats-user').value;
    const period = document.getElementById('clear-stats-period').value;

    const userText = userId === 'all' ? 'all users' : `user ID ${userId}`;
    const periodText = period.replace(/_/g, ' ');

    const confirmed = await showConfirmModal(
        'Confirm Deletion',
        `Are you sure you want to delete statistics for ${userText} within the period "${periodText}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    showLoadingOverlay();
    try {
        const response = await api.clearStatistics({ userId, period });
        if (response.success) {
            showToast(response.message, 'success');
        } else {
            showInfoModal('Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error clearing statistics:", error);
        showInfoModal('Error', `Failed to clear statistics: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function handleClearMacBans() {
    const confirmed = await showConfirmModal(
        'Clear Banned Readers',
        'Are you sure you want to clear ALL banned mac addresses? This action cannot be undone.'
    );

    if (!confirmed) {
        return; 
    }

    showLoadingOverlay();
    try {
        const response = await api.clearMacAddressBans();
        if (response.success) {
            showToast('Banned addresses cleared successfully.', 'success');
        } else {
            showToast(`Error: ${response.message}`, 'error');
        }
    } catch (error) {
        console.error('Failed to clear bans:', error);
        showToast('Failed to connect to the server or an error occurred.', 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function loadStatistics(state) {
    showLoadingOverlay();
    try {
        const pageStatisticsDiv = document.getElementById('page-statistics');
        if (!pageStatisticsDiv) {
            console.error("loadStatistics: #page-statistics div not found.");
            showInfoModal('Statistics Load Error', 'The statistics page container is missing.', 'error');
            hideLoadingOverlay();
            return;
        }

        const statsUserSelect = pageStatisticsDiv.querySelector('#stats-user-filter');
        if (!statsUserSelect) {
            console.error("Element with ID 'stats-user-filter' not found within #page-statistics.");
            showInfoModal('Statistics Load Error', 'Required UI element for user filter not found within the page.', 'error');
            hideLoadingOverlay();
            return;
        }
        
        statsUserSelect.innerHTML = '';

        if (state.user && state.user.isAdmin) {
            if (!Array.isArray(state.users) || state.users.length === 0) {
                const usersResponse = await api.getUsers();
                if (usersResponse.success && Array.isArray(usersResponse.data)) {
                    state.users = usersResponse.data;
                } else {
                    state.users = [];
                }
            }
            const allUsersOption = document.createElement('option');
            allUsersOption.value = '';
            allUsersOption.textContent = 'All Users';
            statsUserSelect.appendChild(allUsersOption);

            state.users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.username;
                statsUserSelect.appendChild(option);
            });
            statsUserSelect.disabled = false;
        } else {
            state.users = [];
            if (state.user && state.user.id && state.user.username) {
                const currentUserOption = document.createElement('option');
                currentUserOption.value = state.user.id;
                currentUserOption.textContent = state.user.username;
                currentUserOption.selected = true;
                statsUserSelect.appendChild(currentUserOption);
                statsUserSelect.disabled = true;
            } else {
                statsUserSelect.innerHTML = '<option value="">N/A</option>';
                statsUserSelect.disabled = true;
            }
        }

        const statsUserFilterElement = document.getElementById('stats-user-filter');
        const statsPeriodFilterElement = document.getElementById('stats-period-filter');

        if (statsUserFilterElement) statsUserFilterElement.onchange = () => fetchAndRenderStats(state);
        if (statsPeriodFilterElement) statsPeriodFilterElement.onchange = () => fetchAndRenderStats(state);

        const choreBreakdownCard = document.getElementById('chore-breakdown-by-user-card');
        if (choreBreakdownCard) {
            if (state.user && !state.user.isAdmin) {
                choreBreakdownCard.classList.add('hidden');
            } else {
                choreBreakdownCard.classList.remove('hidden');
            }
        }

        await fetchAndRenderStats(state);

    } catch (error) {
        console.error("Error setting up statistics page:", error);
        showInfoModal('Statistics Load Error', `Failed to prepare statistics page: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

export async function fetchAndRenderStats(state) {
    showLoadingOverlay();
    try {
        const periodElement = document.getElementById('stats-period-filter');
        const userIdElement = document.getElementById('stats-user-filter');

        const period = periodElement ? periodElement.value : 'last_7_days';
        const userId = (state.user && !state.user.isAdmin) ? state.user.id : (userIdElement ? userIdElement.value : '');

        const response = await api.getStatsSummary(period, userId);

        if (response.success) {
            const statsData = response.data;
            let totalAssigned = 0, totalCompleted = 0, totalMissed = 0;
            statsData.forEach(item => {
                totalAssigned += item.assigned;
                totalCompleted += item.completed;
                totalMissed += item.missed;
            });

            document.getElementById('total-assigned-count').textContent = totalAssigned;
            document.getElementById('total-completed-count').textContent = totalCompleted;
            document.getElementById('total-missed-count').textContent = totalMissed;

            renderCompletionChart(statsData);
            renderChoreBreakdownTable(statsData);
            renderDetailedActivityLog(statsData);
        } else {
            showInfoModal('Statistics Error', response.message, 'error');
        }
    } catch (error) {
        console.error("Error fetching and rendering statistics:", error);
        showInfoModal('Statistics Display Error', `Failed to fetch or display statistics: ${error.message}`, 'error');
    } finally {
        hideLoadingOverlay();
    }
}

function updateUserTableHeadersVisibility(authMethod) {
    const nfcTagIdHeader = document.querySelector('.user-table-nfc-tag-id-header');
    const assignedReaderIdHeader = document.querySelector('.user-table-assigned-reader-id-header');

    if (nfcTagIdHeader) {
        nfcTagIdHeader.classList.toggle('hidden', authMethod !== 'user_tag_signin');
    }
    if (assignedReaderIdHeader) {
        assignedReaderIdHeader.classList.toggle('hidden', authMethod !== 'reader_assigned');
    }
}

function renderUsersTable(users) {
    const usersTableBody = document.getElementById('users-table-body');
    const authMethod = appState.config.authMethod;
    usersTableBody.innerHTML = '';

    users.forEach(user => {
        const row = usersTableBody.insertRow();
        let nfcTagDisplay = 'N/A';
        if (user.nfcTagId && appState.tags) {
            const nfcTag = appState.tags.find(tag => tag.tagId === user.nfcTagId);
            nfcTagDisplay = nfcTag ? `${nfcTag.name} (${nfcTag.tagId})` : user.nfcTagId;
        }
        let readerDisplay = 'N/A';
        if (user.assignedReaderId && appState.readers) {
             const reader = appState.readers.find(r => r.id === user.assignedReaderId);
             readerDisplay = reader ? `${reader.name} (${reader.macAddress})` : `ID: ${user.assignedReaderId}`;
        }

        const nfcColumn = authMethod === 'user_tag_signin' ? `<td>${nfcTagDisplay}</td>` : '';
        const readerColumn = authMethod === 'reader_assigned' ? `<td>${readerDisplay}</td>` : '';

        row.innerHTML = `
            <td>${user.username}</td>
            <td class="center-content"><i class="${user.isAdmin ? 'fas fa-check text-success' : 'fas fa-times text-danger'}"></i></td>
            <td class="center-content"><i class="${user.enabled ? 'fas fa-check text-success' : 'fas fa-times text-danger'}"></i></td>
            ${nfcColumn}
            ${readerColumn}
            <td class="center-content">
                <button class="secondary-btn edit-user-btn" data-id="${user.id}"><i class="fas fa-edit"></i> Edit</button>
                <button class="delete-btn delete-user-btn" data-id="${user.id}"><i class="fas fa-trash-alt"></i> Delete</button>
            </td>
        `;
    });
}

function renderChoresTable(chores) {
    const choresTableBody = document.getElementById('chores-table-body');
    choresTableBody.innerHTML = '';

    chores.forEach(chore => {
        const row = choresTableBody.insertRow();
        let nfcTagDisplay = 'N/A';
        if (chore.nfcTagId && appState.tags) {
            const foundTag = appState.tags.find(t => t.tagId === chore.nfcTagId);
            nfcTagDisplay = foundTag ? `${foundTag.name} (${foundTag.tagId})` : chore.nfcTagId;
        }

        let scheduleDisplay = 'No Schedule';
        if (chore.schedules && chore.schedules.length > 0) {
             scheduleDisplay = chore.schedules.map(s => {
                let text = s.scheduleType.charAt(0).toUpperCase() + s.scheduleType.slice(1);
                if (s.time) text += ` at ${formatTime(s.time)}`;
                return text;
            }).join('<br>');
        }

        row.innerHTML = `
            <td>${chore.name}</td>
            <td>${nfcTagDisplay}</td>
            <td>${chore.duration || 'N/A'}</td>
            <td>${chore.assignmentType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
            <td>${scheduleDisplay}</td>
            <td>${chore.assignedUsernames || 'N/A'}</td>
            <td class="center-content"><i class="${chore.important ? 'fas fa-check text-success' : 'fas fa-times text-danger'}"></i></td>
            <td class="center-content"><i class="${chore.enabled ? 'fas fa-check text-success' : 'fas fa-times text-danger'}"></i></td>
            <td class="center-content">
                <button class="secondary-btn edit-chore-btn" data-id="${chore.id}"><i class="fas fa-edit"></i> Edit</button>
                <button class="delete-btn delete-chore-btn" data-id="${chore.id}"><i class="fas fa-trash-alt"></i> Delete</button>
            </td>
        `;
    });
}

function renderTagsTable(tags) {
    const tagsTableBody = document.getElementById('tags-table-body');
    tagsTableBody.innerHTML = '';

    tags.forEach(tag => {
        const row = tagsTableBody.insertRow();
        row.innerHTML = `
            <td>${tag.name}</td>
            <td>${tag.tagId}</td>
            <td>${tag.type}</td>
            <td class="center-content">
                <button class="secondary-btn edit-tag-btn" data-id="${tag.id}"><i class="fas fa-edit"></i> Edit</button>
                <button class="delete-btn delete-tag-btn" data-id="${tag.id}"><i class="fas fa-trash-alt"></i> Delete</button>
            </td>
        `;
    });
}

function renderReadersTable(readers) {
    const readersTableBody = document.getElementById('readers-table-body');
    readersTableBody.innerHTML = '';

    readers.forEach(reader => {
        const row = readersTableBody.insertRow();
        const statusClass = reader.isOnline ? 'status-online' : 'status-offline';
        const statusText = reader.isOnline ? 'Online' : 'Offline';

        let lastSeenFormatted = 'N/A';
        if (reader.lastSeen && appState.config && appState.config.timezone) {
            try {
                const lastSeenDateTime = DateTime.fromSQL(reader.lastSeen, { zone: 'utc' });
                if (lastSeenDateTime.isValid) {
                    const zonedLastSeen = lastSeenDateTime.setZone(appState.config.timezone);
                    lastSeenFormatted = zonedLastSeen.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);
                }
            } catch (e) {
                console.error(`[AppLogic] Error formatting lastSeen with Luxon (fromSQL): ${reader.lastSeen}`, e);
            }
        }

        row.innerHTML = `
            <td>${reader.name || 'N/A'}</td>
            <td>${reader.macAddress}</td>
			<td>${reader.modelNumber || 'Unknown'}</td>
            <td>${reader.ipAddress || 'N/A'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${lastSeenFormatted}</td>
            <td class="center-content">
                <button class="secondary-btn edit-reader-btn" data-id="${reader.id}" data-mac="${reader.macAddress}" data-name="${reader.name || ''}"><i class="fas fa-edit"></i> Edit</button>
                <button class="delete-btn delete-reader-btn" data-id="${reader.id}"><i class="fas fa-trash-alt"></i> Delete</button>
            </td>
        `;
    });
}

function renderCompletionChart(statsData) {
    const ctxElement = document.getElementById('completion-chart');
    if (!ctxElement) {
        console.error("Chart canvas element with ID 'completion-chart' not found.");
        return;
    }
    const ctx = ctxElement.getContext('2d');

    if (completionChartInstance) {
        completionChartInstance.destroy();
    }

    const aggregatedByDate = statsData.reduce((acc, item) => {
        if (!acc[item.statDate]) {
            acc[item.statDate] = { assigned: 0, completed: 0, missed: 0 };
        }
        acc[item.statDate].assigned += item.assigned;
        acc[item.statDate].completed += item.completed;
        acc[item.statDate].missed += item.missed;
        return acc;
    }, {});

    const sortedDates = Object.keys(aggregatedByDate).sort();
    const labels = sortedDates;
    const completedCounts = sortedDates.map(date => aggregatedByDate[date].completed);
    const missedCounts = sortedDates.map(date => aggregatedByDate[date].missed);

    completionChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completed Chores',
                    data: completedCounts,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Missed Chores',
                    data: missedCounts,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, title: { display: true, text: 'Date' } },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Number of Chores' } }
            },
            plugins: {
                title: { display: true, text: 'Chore Completion Trends' },
                tooltip: { mode: 'index', intersect: false }
            }
        }
    });
}

function renderChoreBreakdownTable(statsData) {
    const tableBody = document.getElementById('chore-breakdown-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const breakdownMap = new Map();
    statsData.forEach(item => {
        const key = `${item.choreName}-${item.userName}`;
        if (!breakdownMap.has(key)) {
            breakdownMap.set(key, { choreName: item.choreName, userName: item.userName, assigned: 0, completed: 0, missed: 0 });
        }
        const entry = breakdownMap.get(key);
        entry.assigned += item.assigned;
        entry.completed += item.completed;
        entry.missed += item.missed;
    });

    const sortedBreakdown = Array.from(breakdownMap.values()).sort((a, b) => {
        if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
        return a.choreName.localeCompare(b.choreName);
    });

    if (sortedBreakdown.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="info-message">No chore breakdown data available for the selected period.</td></tr>';
        return;
    }

    sortedBreakdown.forEach(item => {
        const row = tableBody.insertRow();
        row.innerHTML = `<td>${item.choreName} (${item.userName})</td><td>${item.assigned}</td><td>${item.completed}</td><td>${item.missed}</td>`;
    });
}

function renderDetailedActivityLog(statsData) {
    const tableBody = document.getElementById('stats-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (statsData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="info-message">No detailed activity data available for the selected period.</td></tr>';
        return;
    }

    const sortedLog = [...statsData].sort((a, b) => {
        const dateComparison = b.statDate.localeCompare(a.statDate);
        if (dateComparison !== 0) return dateComparison;
        if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
        return a.choreName.localeCompare(b.choreName);
    });

    sortedLog.forEach(item => {
        const row = tableBody.insertRow();
        row.innerHTML = `<td>${item.statDate}</td><td>${item.choreName}</td><td>${item.userName}</td><td>${item.assigned}</td><td>${item.completed}</td><td>${item.missed}</td>`;
    });
}

function addTableSorting(tableBodyId, data, renderFunction) {
    const table = document.getElementById(tableBodyId)?.closest('.data-table');
    if (!table) return;

    const thead = table.querySelector('thead');
    if (!thead) return;

    thead.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        delete th.dataset.order;
        th.innerHTML = (th.dataset.originalText || th.textContent.replace(/[▲▼]/g, '').trim());
    });

    if (thead.dataset.sortListenerAttached) return;

    thead.querySelectorAll('th[data-sort]').forEach(th => {
        if (!th.dataset.originalText) {
            th.dataset.originalText = th.textContent.replace(/[▲▼]/g, '').trim();
        }
    });

    thead.addEventListener('click', (event) => {
        const header = event.target.closest('th[data-sort]');
        if (!header) return;

        const sortKey = header.dataset.sort;
        const currentOrder = header.dataset.order || 'desc';
        const newOrder = currentOrder === 'desc' ? 'asc' : 'desc';

        thead.querySelectorAll('th[data-sort]').forEach(h => {
            if (h !== header) {
                h.classList.remove('sort-asc', 'sort-desc');
                delete h.dataset.order;
                h.innerHTML = h.dataset.originalText;
            }
        });

        header.classList.remove('sort-asc', 'sort-desc');
        header.classList.add(newOrder === 'asc' ? 'sort-asc' : 'sort-desc');
        header.dataset.order = newOrder;
        const arrow = newOrder === 'asc' ? '▲' : '▼';
        header.innerHTML = header.dataset.originalText + arrow;

        const sortedData = [...data].sort((a, b) => {
            let valA = a[sortKey], valB = b[sortKey];
            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }
            if (valA < valB) return newOrder === 'asc' ? -1 : 1;
            if (valA > valB) return newOrder === 'asc' ? 1 : -1;
            return 0;
        });

        renderFunction(sortedData);
    });

    thead.dataset.sortListenerAttached = 'true';
}

export function toggleAssignmentTypeUI(assignmentType, choreSchedulesContainer, users, assignedUserPoolSelect) {
    const poolAssignmentFields = document.getElementById('pool-assignment-fields');
    if (poolAssignmentFields) {
        poolAssignmentFields.style.display = assignmentType !== 'manual' ? 'block' : 'none';
    }
    if (choreSchedulesContainer) {
        choreSchedulesContainer.querySelectorAll('.schedule-input-block').forEach(block => {
            toggleScheduleFields(block, assignmentType, users);
        });
    }
}

export function addScheduleInput(container, users, currentAssignmentType, scheduleData = null) {
    if (!container) return;
    const block = document.createElement('div');
    block.classList.add('schedule-input-block');
    const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
    block.innerHTML = `
        <span class="remove-schedule-icon"><i class="fas fa-times-circle"></i></span>
        <div class="form-group"><label>Schedule Type:</label><select name="scheduleType" class="schedule-type-select"><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
        <div class="form-group specific-date-field" style="display: none;"><label>Specific Date:</label><input type="date" name="specificDate"></div>
        <div class="form-group days-of-week-field" style="display: none;"><label>Days of Week:</label><div class="checkbox-group-inline">
            <input type="checkbox" name="daysOfWeek" value="0" id="dow-sun-${uniqueId}"><label for="dow-sun-${uniqueId}">Sun</label>
            <input type="checkbox" name="daysOfWeek" value="1" id="dow-mon-${uniqueId}"><label for="dow-mon-${uniqueId}">Mon</label>
            <input type="checkbox" name="daysOfWeek" value="2" id="dow-tue-${uniqueId}"><label for="dow-tue-${uniqueId}">Tue</label>
            <input type="checkbox" name="daysOfWeek" value="3" id="dow-wed-${uniqueId}"><label for="dow-wed-${uniqueId}">Wed</label>
            <input type="checkbox" name="daysOfWeek" value="4" id="dow-thu-${uniqueId}"><label for="dow-thu-${uniqueId}">Thu</label>
            <input type="checkbox" name="daysOfWeek" value="5" id="dow-fri-${uniqueId}"><label for="dow-fri-${uniqueId}">Fri</label>
            <input type="checkbox" name="daysOfWeek" value="6" id="dow-sat-${uniqueId}"><label for="dow-sat-${uniqueId}">Sat</label>
        </div></div>
        <div class="form-group time-field"><label>Time (Optional):</label><input type="time" name="time"></div>
        <div class="form-group assigned-user-field"><label>Assigned User:</label><select name="assignedUserId"><option value="">(None)</option>${Array.isArray(users) ? users.map(user => `<option value="${user.id}">${user.username}</option>`).join('') : ''}</select></div>
    `;
    container.appendChild(block);

    if (scheduleData) {
        const scheduleTypeSelect = block.querySelector('.schedule-type-select');
        if (scheduleTypeSelect) scheduleTypeSelect.value = scheduleData.scheduleType;
        const specificDateInput = block.querySelector('[name="specificDate"]');
        if (specificDateInput) specificDateInput.value = scheduleData.specificDate;
        if (scheduleData.daysOfWeek) {
            scheduleData.daysOfWeek.split(',').forEach(day => {
                const checkbox = block.querySelector(`input[name="daysOfWeek"][value="${day}"]`);
                if (checkbox) checkbox.checked = true;
            });
        }
        const timeInput = block.querySelector('[name="time"]');
        if (timeInput) timeInput.value = scheduleData.time;
        const assignedUserIdSelect = block.querySelector('[name="assignedUserId"]');
        if (assignedUserIdSelect) assignedUserIdSelect.value = scheduleData.assignedUserId;
    }

    const scheduleTypeSelect = block.querySelector('.schedule-type-select');
    if (scheduleTypeSelect) {
        toggleScheduleFields(block, currentAssignmentType);
        scheduleTypeSelect.addEventListener('change', () => toggleScheduleFields(block, currentAssignmentType));
    }
    const removeIcon = block.querySelector('.remove-schedule-icon');
    if (removeIcon) removeIcon.addEventListener('click', () => block.remove());
}

export function toggleScheduleFields(scheduleBlock, assignmentType) {
    if (!scheduleBlock) return;
    const scheduleType = scheduleBlock.querySelector('.schedule-type-select')?.value;
    scheduleBlock.querySelector('.specific-date-field').style.display = scheduleType === 'once' ? 'block' : 'none';
    scheduleBlock.querySelector('.days-of-week-field').style.display = scheduleType === 'weekly' ? 'block' : 'none';
    const assignedUserField = scheduleBlock.querySelector('.assigned-user-field');
    if (assignedUserField) {
        assignedUserField.style.display = assignmentType === 'manual' ? 'block' : 'none';
        if (assignmentType !== 'manual') {
            assignedUserField.querySelector('select').value = '';
        }
    }
}

export async function loadNfcTagsForChoreDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await api.getTags();
        if (response.success && Array.isArray(response.data)) {
            appState.tags = response.data;
            const choreTags = response.data.filter(tag => tag.type === 'chore');
            selectElement.innerHTML = '<option value="">(None)</option>';
            choreTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag.id;
                option.textContent = `${tag.name} (${tag.tagId})`;
                selectElement.appendChild(option);
            });
        } else {
            showToast('Failed to load tags for chore dropdown.', 'error');
        }
    } catch (error) {
        showToast('Error loading tags for chore dropdown.', 'error');
    }
}

export async function loadNfcTagsForUserDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await api.getTags();
        if (response.success && Array.isArray(response.data)) {
            const userTags = response.data.filter(tag => tag.type === 'user');
            selectElement.innerHTML = '<option value="">(None)</option>';
            userTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag.id;
                option.textContent = `${tag.name} (${tag.tagId})`;
                selectElement.appendChild(option);
            });
        } else {
            showToast('Failed to load tags for user dropdown.', 'error');
        }
    }
    catch (error) {
        showToast('Error loading tags for user dropdown.', 'error');
    }
}

export async function loadNfcTagsForSettingDropdown(selectElement, filterType) {
    if (!selectElement) return;
    try {
        const response = await api.getTags();
        if (response.success && Array.isArray(response.data)) {
            const filteredTags = response.data.filter(tag => tag.type === filterType);
            selectElement.innerHTML = '<option value="">(None)</option>';
            filteredTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag.tagId;
                option.textContent = `${tag.name} (${tag.tagId})`;
                selectElement.appendChild(option);
            });
        } else {
            showToast(`Failed to load tags for settings dropdown.`, 'error');
        }
    } catch (error) {
        showToast(`Error loading tags for settings dropdown.`, 'error');
    }
}

export async function loadNfcReadersForUserDropdown(selectElement) {
    if (!selectElement) return;
    try {
        const response = await api.getReaders();
        if (response.success && Array.isArray(response.data)) {
            appState.readers = response.data;
            selectElement.innerHTML = '<option value="">(None)</option>';
            response.data.forEach(reader => {
                const option = document.createElement('option');
                option.value = reader.id;
                option.textContent = `${reader.name || reader.macAddress} (${reader.isOnline ? 'Online' : 'Offline'})`;
                selectElement.appendChild(option);
            });
        } else {
            showToast('Failed to load Chorecast Readers for user dropdown.', 'error');
        }
    } catch (error) {
        showToast('Error loading Chorecast Readers for user dropdown.', 'error');
    }
}

async function loadUsersForChorePool(customSelectElement) {
    if (!customSelectElement) return;
    try {
        const response = await api.getUsers();
        if (response.success && Array.isArray(response.data)) {
            appState.users = response.data;
            const optionsDropdown = customSelectElement.querySelector('.options-dropdown');
            if (!optionsDropdown) return;
            optionsDropdown.innerHTML = '';

            appState.users.forEach(user => {
                const optionDiv = document.createElement('div');
                optionDiv.classList.add('custom-multi-select-option');
                optionDiv.innerHTML = `<input type="checkbox" id="user-pool-${user.id}" value="${user.id}"><label for="user-pool-${user.id}">${user.username}</label>`;
                optionsDropdown.appendChild(optionDiv);

                optionDiv.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                    let selectedIds = JSON.parse(customSelectElement.dataset.selectedIds || '[]');
                    const userId = parseInt(e.target.value);
                    if (e.target.checked) {
                        if (!selectedIds.includes(userId)) selectedIds.push(userId);
                    } else {
                        selectedIds = selectedIds.filter(id => id !== userId);
                    }
                    customSelectElement.dataset.selectedIds = JSON.stringify(selectedIds);
                    updateCustomMultiSelectDisplay(customSelectElement, appState.users);
                });
            });

            const selectedItemsDisplay = customSelectElement.querySelector('.selected-items-display');
            if (selectedItemsDisplay) {
                selectedItemsDisplay.onclick = (event) => {
                    if (!event.target.classList.contains('remove-item')) {
                        customSelectElement.classList.toggle('active');
                    }
                };
            }

            document.addEventListener('click', (event) => {
                if (!customSelectElement.contains(event.target)) {
                    customSelectElement.classList.remove('active');
                }
            });
        }
    } catch (error) {
        console.error("Error loading users for chore pool dropdown:", error);
    }
}

function updateCustomMultiSelectDisplay(customSelectElement, allUsers) {
    if (!customSelectElement) return;
    const selectedItemsDisplay = customSelectElement.querySelector('.selected-items-display');
    const optionsDropdown = customSelectElement.querySelector('.options-dropdown');
    const selectedIds = JSON.parse(customSelectElement.dataset.selectedIds || '[]');

    if (!selectedItemsDisplay || !optionsDropdown) return;
    selectedItemsDisplay.innerHTML = '';

    if (selectedIds.length === 0) {
        const placeholder = document.createElement('span');
        placeholder.classList.add('placeholder');
        placeholder.textContent = 'Select users...';
        selectedItemsDisplay.appendChild(placeholder);
    } else {
        selectedIds.forEach(id => {
            const user = allUsers.find(u => u.id === id);
            if (user) {
                const item = document.createElement('span');
                item.classList.add('selected-item');
                item.innerHTML = `${user.username} <span class="remove-item" data-id="${user.id}">&times;</span>`;
                selectedItemsDisplay.appendChild(item);
                item.querySelector('.remove-item').addEventListener('click', (event) => {
                    event.stopPropagation();
                    const removedId = parseInt(event.currentTarget.dataset.id);
                    let currentIds = JSON.parse(customSelectElement.dataset.selectedIds || '[]');
                    let newIds = currentIds.filter(cid => cid !== removedId);
                    customSelectElement.dataset.selectedIds = JSON.stringify(newIds);
                    updateCustomMultiSelectDisplay(customSelectElement, allUsers);
                });
            }
        });
    }

    optionsDropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = selectedIds.includes(parseInt(checkbox.value));
    });
}