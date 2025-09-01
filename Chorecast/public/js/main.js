import {
    appState, api, showLoadingOverlay, hideLoadingOverlay, showToast,
    connectMqtt, disconnectMqtt, loginUser, logoutUser, showInfoModal, hideModal, showConfirmModal,
    initiateTagScanInModal, closeTagModal, fetchAndStoreConfig
} from './app_core.js';

import * as appLogic from './app_logic.js'; 

window.appLogic = appLogic; 

window.appState = appState; 

const pageLoaders = {
    dashboard: { func: appLogic.loadDashboard, contentId: 'page-dashboard' },
    users: { func: appLogic.loadUsers, contentId: 'page-users' },
    chores: { func: appLogic.loadChores, contentId: 'page-chores' },
    tags: { func: appLogic.loadTags, contentId: 'page-tags' },
    readers: { func: appLogic.loadReaders, contentId: 'page-readers' },
    settings: { func: appLogic.loadSettings, contentId: 'page-settings' },
    statistics: { func: appLogic.loadStatistics, contentId: 'page-statistics' }
};

appState.onLogout = () => {
    console.log('[Main Debug] appState.onLogout callback triggered.');
    logoutUserUI(); 

};

appState.onSettingsUpdated = async () => { 

    console.log('[Main Debug] appState.onSettingsUpdated callback triggered. Refreshing UI.');
    await fetchAndStoreConfig(); 

    if (appState.user && appState.user.isAdmin) {
        await appLogic.loadUsers(appState);
    }
    updateAuthUI(appState.user !== null);
    navigate(appState.currentPage || 'dashboard', true);
};

appState.onDashboardUpdated = async (data) => { 

    console.log('[Main Debug] appState.onDashboardUpdated callback triggered. Data (optional):', data);
    if (data && data.message) {
        showToast(data.message, data.status === 'success' ? 'success' : 'error');
    }
    if (appState.currentPage === 'dashboard') {
        await appLogic.loadDashboard(appState);
    }
};

appState.onStatisticsUpdated = async () => {
    console.log('[Main Debug] appState.onStatisticsUpdated callback triggered.');
    if (appState.currentPage === 'statistics') {
        await appLogic.loadStatistics(appState);
    }
};

appState.onReaderStatusUpdate = (data) => {
    console.log('[Main Debug] appState.onReaderStatusUpdate callback triggered. Data:', data);
    appLogic.updateReaderStatusDisplay(appState);
};

appState.onNfcScanFeedback = (feedback) => {
    appLogic.updateTagScanModalFeedback(feedback);
};

export async function navigate(pageId, forceReload = false) {
    console.log(`[Main Nav Debug] navigate() called for page: ${pageId}. Current appState.currentPage: ${appState.currentPage}`);

    const mainContentInner = document.getElementById('content-area-inner');
    const sidebarNav = document.querySelector('.main-nav ul');
    const appLayout = document.querySelector('.app-layout');

    if (appState.currentPage === pageId && !forceReload) {
        if (pageId === 'dashboard') {
            await appLogic.loadDashboard(appState);
        } else if (pageId === 'statistics') {
            await appLogic.loadStatistics(appState);
        }
        return;
    }

    if (pageId === 'login') {
        updateAuthUI(false);
        return;
    }

    showLoadingOverlay();

    if (mainContentInner) {
        const pageContents = mainContentInner.querySelectorAll('.page-content');
        pageContents.forEach(section => section.classList.add('hidden'));
    }

    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.classList.contains('is-visible')) {
            hideModal(modal.id);
        }
    });

    if (sidebarNav) {
        const navLinks = sidebarNav.querySelectorAll('a');
        navLinks.forEach(link => link.classList.remove('active'));
        const activeLink = sidebarNav.querySelector(`a[data-page="${pageId}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }

    appState.currentPage = pageId;
    if (pageId !== 'login') {
        localStorage.setItem('lastPage', pageId);
    }

    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
        try {
            const loadFunction = pageLoaders[pageId].func;
            if (typeof loadFunction === 'function') {
                await loadFunction(appState);
            } else {
                showInfoModal('Page Error', `Content for ${pageId} page could not be loaded.`, 'warning');
            }
        } catch (error) {
            showInfoModal('Page Load Error', `There was an error loading the ${pageId} page: ${error.message}`, 'error');
        }
    } else {
        showInfoModal('Page Not Found', `The page "${pageId}" could not be found.`, 'error');
    }

    hideLoadingOverlay();
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function updateAuthUI(isLoggedIn) {
    const loginPage = document.getElementById('login-view');
    const appLayout = document.querySelector('.app-layout');
    const mobileHeader = document.querySelector('.mobile-header');
    const usernameDisplay = document.getElementById('logged-in-username');
    const userRoleDisplay = document.getElementById('logged-in-user-role');
    const sidebar = document.querySelector('.sidebar');
    const navUsers = document.getElementById('nav-users');
    const navChores = document.getElementById('nav-chores');
    const navNfcTags = document.getElementById('nav-nfc-tags');
    const navReaders = document.getElementById('nav-readers');
    const navSettings = document.getElementById('nav-settings');
    const statsUserFilterGroup = document.querySelector('#page-statistics .filters-container .form-group label[for="stats-user"]')?.closest('.form-group');

    if (isLoggedIn) {
        if (loginPage) loginPage.style.display = 'none';
        if (appLayout) appLayout.style.display = 'flex';
        if (mobileHeader) mobileHeader.style.display = 'flex';

        if (appState.user && usernameDisplay && userRoleDisplay) {
            usernameDisplay.textContent = appState.user.username;
            userRoleDisplay.textContent = appState.user.isAdmin ? 'Admin' : 'User';
        }

        const isAdmin = appState.user && appState.user.isAdmin;
        if (navUsers) navUsers.classList.toggle('hidden', !isAdmin);
        if (navChores) navChores.classList.toggle('hidden', !isAdmin);
        if (navNfcTags) navNfcTags.classList.toggle('hidden', !isAdmin);
        if (navReaders) navReaders.classList.toggle('hidden', !isAdmin);
        if (navSettings) navSettings.classList.toggle('hidden', !isAdmin);
        if (statsUserFilterGroup) statsUserFilterGroup.classList.toggle('hidden', !isAdmin);

        connectMqtt();
        appLogic.updateReaderStatusDisplay(appState);
        if (sidebar) sidebar.classList.remove('hidden-for-login');
    } else {
        if (loginPage) loginPage.style.display = 'flex';
        if (appLayout) appLayout.style.display = 'none';
        if (mobileHeader) mobileHeader.style.display = 'none';
        if (usernameDisplay) usernameDisplay.textContent = 'Guest';
        if (userRoleDisplay) userRoleDisplay.textContent = '';
        if (navUsers) navUsers.classList.add('hidden');
        if (navChores) navChores.classList.add('hidden');
        if (navNfcTags) navNfcTags.classList.add('hidden');
        if (navReaders) navReaders.classList.add('hidden');
        if (navSettings) navSettings.classList.add('hidden');
        if (statsUserFilterGroup) statsUserFilterGroup.classList.add('hidden');
        disconnectMqtt();
        if (sidebar) {
            sidebar.classList.add('hidden-for-login');
            sidebar.classList.remove('active');
        }
    }
    updateSidebarVisibility();
}

async function handleLogin(event) {
    event.preventDefault();
    showLoadingOverlay();
    const loginForm = document.getElementById('login-form');
    const username = loginForm.username.value;
    const password = loginForm.password.value;
    try {
        const response = await api.login(username, password);
        if (response.success) {
            loginUser({ id: response.data.id, username: response.data.username, isAdmin: response.data.isAdmin }, response.data.token);
            showToast('Login Successful!', 'success');
            await appLogic.loadSettings(appState);
            if (appState.user && appState.user.isAdmin) {
                await appLogic.loadUsers(appState);
            }
            updateAuthUI(true);
            let lastPage = localStorage.getItem('lastPage') || 'dashboard';
            if (lastPage === 'login') {
                lastPage = 'dashboard';
                localStorage.setItem('lastPage', 'dashboard');
            }
            await navigate(lastPage);
        } else {
            showInfoModal('Login Failed', response.message, 'error');
        }
    } catch (error) {
        if (!error.message.includes('Authentication failed')) {
            showInfoModal('Login Error', 'Failed to connect to server or unexpected error: ' + error.message, 'error');
        }
    } finally {
        hideLoadingOverlay();
    }
}

function logoutUserUI() {
    showToast('Logged out successfully.', 'info');
    updateAuthUI(false);
}

function updateSidebarVisibility() {
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('mobile-menu-open');
    const closeSidebarButton = document.getElementById('mobile-menu-close');
    const mobileHeader = document.querySelector('.mobile-header');
    const contentArea = document.querySelector('.content-area');
    const appLayout = document.querySelector('.app-layout');

    if (window.innerWidth < 768) {
        if (sidebar) {
            sidebar.classList.remove('is-visible');
            sidebar.classList.add('hidden-mobile');
            sidebar.classList.remove('active');
            sidebar.style.transform = 'translateX(-100%)';
            sidebar.style.visibility = 'hidden';
            if (appLayout) appLayout.classList.remove('sidebar-open');
        }
        if (sidebarToggle) sidebarToggle.style.display = 'block';
        if (closeSidebarButton) closeSidebarButton.style.display = 'block';
        if (mobileHeader) mobileHeader.style.display = 'flex';
        if (contentArea) contentArea.style.marginLeft = '0';
    } else {
        if (sidebar) {
            sidebar.classList.remove('hidden-mobile');
            sidebar.classList.add('is-visible');
            sidebar.classList.remove('active');
            sidebar.style.transform = 'translateX(0)';
            sidebar.style.visibility = 'visible';
            if (appLayout) appLayout.classList.remove('sidebar-open');
        }
        if (sidebarToggle) sidebarToggle.style.display = 'none';
        if (closeSidebarButton) closeSidebarButton.style.display = 'none';
        if (mobileHeader) mobileHeader.style.display = 'none';
        if (contentArea) contentArea.style.marginLeft = '250px';
    }
}

document.addEventListener('DOMContentLoaded', async () => {

    appState.ui.mainContent = document.getElementById('content-area-inner');
    appState.ui.loadingSpinner = document.querySelector('.loading-spinner');
    appState.ui.toastContainer = document.getElementById('toast-container');
    appState.ui.infoModal = document.getElementById('info-modal');
    appState.ui.infoModalTitle = document.getElementById('info-modal-title');
    appState.ui.infoModalMessage = document.getElementById('info-modal-message');
    appState.ui.infoModalConfirmBtn = document.getElementById('info-modal-ok-button');
    appState.ui.infoModalCancelBtn = document.getElementById('info-modal-close-button');
    appState.ui.infoModalCloseBtn = document.getElementById('info-modal-x-button');
    appState.ui.tagScanModal = document.getElementById('tag-modal');
    appState.ui.tagIdInput = document.getElementById('tag-id-input');
    appState.ui.listenForTagBtn = document.getElementById('listen-for-tag-btn');
    appState.ui.tagScanFeedback = document.querySelector('#tag-modal .scan-feedback-message');

    const loginForm = document.getElementById('login-form');
    const logoutButton = document.getElementById('logout-btn');
    const sidebarNav = document.querySelector('.main-nav ul');
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('mobile-menu-open');
    const closeSidebarButton = document.getElementById('mobile-menu-close');
    const mobileLogoutButton = document.getElementById('mobile-menu-logout');
    const appLayout = document.querySelector('.app-layout');

    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (logoutButton) logoutButton.addEventListener('click', () => logoutUser());
    if (mobileLogoutButton) mobileLogoutButton.addEventListener('click', () => logoutUser());
    if (sidebarNav) {
        sidebarNav.addEventListener('click', (e) => {
            const navLink = e.target.closest('a');
            if (navLink && navLink.dataset.page) {
                e.preventDefault();
                navigate(navLink.dataset.page);
                if (window.innerWidth < 768 && sidebar) {
                    sidebar.classList.remove('active');
                    sidebar.style.transform = 'translateX(-100%)';
                    sidebar.style.visibility = 'hidden';
                    if (appLayout) appLayout.classList.remove('sidebar-open');
                }
            }
        });
    }
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            if (sidebar) {
                sidebar.classList.add('active');
                sidebar.style.transform = 'translateX(0%)';
                sidebar.style.visibility = 'visible';
                if (appLayout) appLayout.classList.add('sidebar-open');
            }
        });
    }
    if (closeSidebarButton) {
        closeSidebarButton.addEventListener('click', () => {
            if (sidebar) {
                sidebar.classList.remove('active');
                sidebar.style.transform = 'translateX(-100%)';
                sidebar.style.visibility = 'hidden';
                if (appLayout) appLayout.classList.remove('sidebar-open');
            }
        });
    }

    document.querySelectorAll('.modal .close-button').forEach(button => button.addEventListener('click', e => hideModal(e.target.closest('.modal').id)));
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) hideModal(modal.id); }));
    document.getElementById('user-modal-close-button')?.addEventListener('click', () => hideModal('user-modal'));
    document.getElementById('chore-modal-close-button')?.addEventListener('click', () => hideModal('chore-modal'));
    document.getElementById('tag-modal-close-button')?.addEventListener('click', () => closeTagModal());
    document.getElementById('reader-modal-close-button')?.addEventListener('click', () => hideModal('reader-modal'));
    if (appState.ui.listenForTagBtn) appState.ui.listenForTagBtn.addEventListener('click', async () => await initiateTagScanInModal());

    const setupDelegatedListener = (pageId, logicMap) => {
        const page = document.getElementById(pageId);
        if (page) {
            page.addEventListener('click', (e) => {
                const button = e.target.closest('button[data-id]');
                if (!button) return;
                const id = button.dataset.id;
                for (const className in logicMap) {
                    if (button.classList.contains(className)) {
                        logicMap[className](id, button);
                        return;
                    }
                }
            });
        }
    };
    setupDelegatedListener('page-users', {
        'edit-user-btn': (id) => appLogic.openUserModal(appState, id),
        'delete-user-btn': (id) => appLogic.deleteUser(appState, id)
    });
    setupDelegatedListener('page-chores', {
        'edit-chore-btn': (id) => appLogic.openChoreModal(appState, id),
        'delete-chore-btn': (id) => appLogic.deleteChore(appState, id)
    });
    setupDelegatedListener('page-tags', {
        'edit-tag-btn': (id) => appLogic.openTagModal(appState, id),
        'delete-tag-btn': (id) => appLogic.deleteTag(appState, id)
    });
    setupDelegatedListener('page-readers', {
        'edit-reader-btn': (id, button) => appLogic.openReaderModal(id, button.dataset.mac, button.dataset.name),
        'delete-reader-btn': (id) => appLogic.deleteReader(appState, id)
    });

    document.getElementById('add-chore-btn')?.addEventListener('click', () => appLogic.openChoreModal(appState));
    document.getElementById('add-user-btn')?.addEventListener('click', () => appLogic.openUserModal(appState));
    document.getElementById('add-tag-btn')?.addEventListener('click', () => appLogic.openTagModal(appState));

    await loadInitialAppState();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => console.log('Service Worker registered.', reg))
                .catch(err => console.error('Service Worker registration failed:', err));
        });
    }
});

async function loadInitialAppState() {
    showLoadingOverlay();
    await fetchAndStoreConfig();
    const storedUser = localStorage.getItem('chorecastUser');
	const storedViewMode = localStorage.getItem('dashboardViewMode');
    if (storedViewMode) {
        appState.dashboardViewMode = storedViewMode;
    }
    if (storedUser) {
        try {
            const parsedUser = JSON.parse(storedUser);
            appState.user = { ...parsedUser, isAdmin: !!parsedUser.isAdmin };
            api.setAuthToken(localStorage.getItem('chorecastToken'));
            const response = await api.getSettings();
            if (response.success) {
                appState.settings = response.data;
                if (appState.user && appState.user.isAdmin) {
                    await appLogic.loadUsers(appState);
                }
                updateAuthUI(true);
                let lastPage = localStorage.getItem('lastPage') || 'dashboard';
                if (lastPage === 'login') lastPage = 'dashboard';
                await navigate(lastPage);
            } else {
                logoutUser();
            }
        } catch (error) {
            logoutUser();
        }
    } else {
        updateAuthUI(false);
    }
    hideLoadingOverlay();
    window.addEventListener('resize', updateSidebarVisibility);
    updateSidebarVisibility();
}