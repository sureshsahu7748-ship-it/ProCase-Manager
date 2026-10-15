// 🛟 SweetAlert लोड न हो पाए (जैसे पहली बार ऑफ़लाइन खुलने पर) तब भी ऐप न टूटे
if (typeof window.Swal === 'undefined') {
    const fallbackToast = (opts) => {
        const msg = typeof opts === 'string' ? opts : ((opts && (opts.title || opts.text)) || '');
        if (!msg) return;
        const el = document.createElement('div');
        el.textContent = String(msg).replace(/<[^>]*>/g, '');
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);max-width:90vw;padding:10px 16px;border-radius:12px;background:#1f2937;color:#fff;font-size:14px;z-index:99999;box-shadow:0 6px 20px rgba(0,0,0,.3)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    };
    window.Swal = {
        fire(opts) { fallbackToast(opts); return Promise.resolve({ isConfirmed: false, isDismissed: true }); },
        mixin() { return { fire: (opts) => window.Swal.fire(opts) }; },
        close() {},
        showLoading() {}
    };
}

 let expenses = JSON.parse(localStorage.getItem('expenses')) || [];
let activeGroup = JSON.parse(localStorage.getItem('activeGroup')) || null;
let userIncome = parseFloat(localStorage.getItem('userIncome')) || 0;
let categoryBudgets = JSON.parse(localStorage.getItem('categoryBudgets')) || {};
let myChart = null;

// ==========================================
// ⚡ 1. FIREBASE OFFLINE PERSISTENCE
// ==========================================
if (typeof db !== "undefined") {
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
        // Handled silently
    });
}

let currentUser = null;

// 🛡️ Helpers: HTML escape (XSS से बचाव), पैसे का फ़ॉर्मेट, आज की लोकल तारीख
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function fmtMoney(value) {
    const n = Math.round((Number(value) || 0) * 100) / 100;
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function todayLocal() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function safeFileName(name) {
    return String(name || 'report').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'report';
}

// ☁️ लॉगिन से पहले किए गए बदलाव याद रखना, ताकि लॉगिन पर डेटा खो न जाए
function getUnsynced() {
    try {
        const v = JSON.parse(localStorage.getItem('unsyncedChanges') || '{}');
        return { up: Array.isArray(v.up) ? v.up.map(String) : [], del: Array.isArray(v.del) ? v.del.map(String) : [] };
    } catch (_) { return { up: [], del: [] }; }
}
function saveUnsynced(u) { localStorage.setItem('unsyncedChanges', JSON.stringify(u)); }
function markUnsyncedUpload(id) {
    const u = getUnsynced();
    u.del = u.del.filter(x => x !== String(id));
    if (!u.up.includes(String(id))) u.up.push(String(id));
    saveUnsynced(u);
}
function markUnsyncedDelete(id) {
    const u = getUnsynced();
    u.up = u.up.filter(x => x !== String(id));
    if (!u.del.includes(String(id))) u.del.push(String(id));
    saveUnsynced(u);
}

// 🔒 SHA-256 Encryption Helper
async function hashPin(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 🎨 Helper Toast Notification
function showToast(icon, title) {
    if (typeof Swal !== "undefined") {
        Swal.fire({
            icon: icon,
            title: escapeHtml(title),
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initDynamicIcon(); 
    initTheme();
    initLockSystem();  
    initFeatures();
    initCategoryBudgetSystem();
    initSplitSystem();
    initGroupInviteShare();
    initAuthSystem();
    initSidebar();
    initProfileEditor();
    initAppNavigation();
    initVoiceInput();
    initAccountDelete();
    renderExpenses();
    updateDashboard();


    if (document.getElementById('date')) {
        document.getElementById('date').value = todayLocal();
    }
});

// ==========================================
// 🌐 2. DYNAMIC ICON SWITCHER (FAVICON ONLY)
// ==========================================
function initDynamicIcon() {
    const onlineIconUrl = "icon-192.png"; 
    const offlineIconUrl = "logo.svg"; 

    const updateIcon = () => {
        const favicon = document.getElementById('appFavicon');

        if (navigator.onLine) {
            if (favicon) favicon.href = onlineIconUrl;
        } else {
            if (favicon) favicon.href = offlineIconUrl;
        }
    };

    updateIcon();
    window.addEventListener('online', updateIcon);
    window.addEventListener('offline', updateIcon);
}

// ==========================================
// 🔒 3. UPDATED SECURE LOCK SYSTEM
// ==========================================
function initLockSystem() {
    const lockScreen = document.getElementById('lockScreen');
    const unlockPinInput = document.getElementById('unlockPin');
    const oldPinInput = document.getElementById('oldPinInput');
    const verifyPinBtn = document.getElementById('verifyPinBtn');
    const resetPinBtn = document.getElementById('resetPinBtn');
    const disablePinBtn = document.getElementById('disablePinBtn');
    const openPinBtn = document.getElementById('openPinBtn');
    const lockTitle = document.getElementById('lockTitle');
    const lockSubText = document.getElementById('lockSubText');

    let savedPinHash = localStorage.getItem('userAppPinHash');
    let currentMode = 'UNLOCK';
    let failedAttempts = 0;
    let lockedUntil = 0;

    if (savedPinHash && lockScreen) {
        currentMode = 'UNLOCK';
        lockScreen.style.display = 'flex';
        lockTitle.textContent = '🔒 ऐप सुरक्षित है';
        lockSubText.textContent = 'कृपया अपना 4-अंकों का पिन दर्ज करें';
        if (oldPinInput) oldPinInput.style.display = 'none';
        if (unlockPinInput) {
            unlockPinInput.style.display = 'block';
            unlockPinInput.placeholder = '4-अंकों का पिन';
        }
        if (verifyPinBtn) verifyPinBtn.textContent = 'अनलॉक करें';
        if (disablePinBtn) disablePinBtn.style.display = 'inline-block';
    }

    if (openPinBtn) {
        openPinBtn.onclick = () => {
            savedPinHash = localStorage.getItem('userAppPinHash');
            lockScreen.style.display = 'flex';

            if (savedPinHash) {
                setFormMode('RESET');
            } else {
                setFormMode('NEW');
            }
        };
    }

    if (disablePinBtn) {
        disablePinBtn.onclick = () => {
            setFormMode('DISABLE');
        };
    }

    if (resetPinBtn) {
        resetPinBtn.onclick = () => {
            setFormMode('RESET');
        };
    }

    function setFormMode(mode) {
        currentMode = mode;
        if (unlockPinInput) unlockPinInput.value = '';
        if (oldPinInput) oldPinInput.value = '';

        if (mode === 'DISABLE') {
            lockTitle.textContent = '🚫 पिन सुरक्षा बंद करें';
            lockSubText.textContent = 'पिन हटाने के लिए केवल अपना पुराना पिन दर्ज करें';
            oldPinInput.style.display = 'block';
            oldPinInput.placeholder = 'पुराना पिन (Old PIN)';
            unlockPinInput.style.display = 'none';
            verifyPinBtn.textContent = 'पिन बताएं (Remove PIN)';
            if (disablePinBtn) disablePinBtn.style.display = 'none';
        } 
        else if (mode === 'RESET') {
            lockTitle.textContent = '🔑 पिन बदलें (Reset PIN)';
            lockSubText.textContent = 'पुराना और नया पिन दर्ज करें';
            oldPinInput.style.display = 'block';
            oldPinInput.placeholder = 'पुराना पिन';
            unlockPinInput.style.display = 'block';
            unlockPinInput.placeholder = 'नया 4-अंकों का पिन';
            verifyPinBtn.textContent = 'सत्यापित करें एवं बदलें';
            if (disablePinBtn) disablePinBtn.style.display = 'inline-block';
        }
        else if (mode === 'NEW') {
            lockTitle.textContent = '🔑 नया पिन बनाएं';
            lockSubText.textContent = 'नया 4-अंकों का पिन सेट करें';
            oldPinInput.style.display = 'none';
            unlockPinInput.style.display = 'block';
            unlockPinInput.placeholder = 'नया 4-अंकों का पिन';
            verifyPinBtn.textContent = 'नया पिन सेव करें';
            if (disablePinBtn) disablePinBtn.style.display = 'none';
        }
    }

    if (verifyPinBtn) {
        verifyPinBtn.onclick = async () => {
            const enteredPin = unlockPinInput.value.trim();
            const enteredOldPin = oldPinInput ? oldPinInput.value.trim() : '';

            if (currentMode === 'UNLOCK') {
                const waitSec = Math.ceil((lockedUntil - Date.now()) / 1000);
                if (waitSec > 0) {
                    showToast('warning', `${waitSec} सेकंड बाद दोबारा कोशिश करें।`);
                    return;
                }
                const inputHash = await hashPin(enteredPin);
                if (inputHash === savedPinHash) {
                    failedAttempts = 0;
                    lockScreen.style.display = 'none';
                    unlockPinInput.value = '';
                    showToast('success', 'स्वागत है!');
                } else {
                    failedAttempts++;
                    unlockPinInput.value = '';
                    if (failedAttempts >= 5) {
                        failedAttempts = 0;
                        lockedUntil = Date.now() + 30000;
                        showToast('error', '5 बार गलत पिन! 30 सेकंड रुकें।');
                    } else {
                        showToast('error', 'गलत पिन!');
                    }
                }
            } 
            else if (currentMode === 'DISABLE') {
                if (!enteredOldPin) {
                    showToast('warning', 'कृपया अपना पुराना पिन दर्ज करें!');
                    return;
                }
                const oldHash = await hashPin(enteredOldPin);
                if (oldHash !== savedPinHash) {
                    showToast('error', 'गलत पुराना पिन!');
                    return;
                }

                localStorage.removeItem('userAppPinHash');
                savedPinHash = null;
                lockScreen.style.display = 'none';
                if (oldPinInput) oldPinInput.value = '';
                showToast('info', '🔓 पिन सुरक्षा सफलतापूर्वक हटा दी गई है!');
            }
            else if (currentMode === 'RESET' || currentMode === 'NEW') {
                if (currentMode === 'RESET') {
                    const oldHash = await hashPin(enteredOldPin);
                    if (oldHash !== savedPinHash) {
                        showToast('error', 'गलत पुराना पिन!');
                        return;
                    }
                }

                if (!/^\d{4}$/.test(enteredPin)) {
                    showToast('warning', 'कृपया 4 अंकों का सही पिन दर्ज करें!');
                    return;
                }

                const newHash = await hashPin(enteredPin);
                localStorage.setItem('userAppPinHash', newHash);
                savedPinHash = newHash;

                showToast('success', '🔒 नया पिन सुरक्षित रूप से सेट कर दिया गया!');
                lockScreen.style.display = 'none';
                unlockPinInput.value = '';
                if (oldPinInput) oldPinInput.value = '';
            }
        };
    }
}

// ==========================================
// 🔑 4. GOOGLE AUTHENTICATION SYSTEM
// ==========================================
function initAuthSystem() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserStatus = document.getElementById('sidebarUserStatus');
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const profileEditBtn = document.getElementById('profileEditBtn');

    if (loginBtn) {
        loginBtn.onclick = () => {
            if (typeof firebase === "undefined") {
                return showToast('error', "Firebase लोड नहीं हुआ है!");
            }
            if (typeof Swal !== "undefined") {
                Swal.fire({
                    title: 'लॉगइन हो रहा है...',
                    text: 'कृपया प्रतीक्षा करें',
                    allowOutsideClick: false,
                    didOpen: () => { Swal.showLoading(); }
                });
            }

            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });

            firebase.auth().signInWithPopup(provider)
                .then((result) => {
                    if (typeof Swal !== "undefined") Swal.close();
                    showToast('success', `स्वागत है ${result.user.displayName || 'यूज़र'}!`);
                    closeSidebar();
                })
                .catch((error) => {
                    if (typeof Swal !== "undefined") Swal.close();
                    showToast('error', "लॉगइन असफल: " + error.message);
                });
        };
    }

    // लॉग इन/साइन अप: Google और ईमेल, दोनों इसी पेज पर हैं
    if (loginBtn) loginBtn.onclick = () => { location.href = '/auth.html?next=/'; };

    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if (typeof firebase === "undefined" || !firebase.auth) {
                return showToast('error', 'Firebase लोड नहीं हुआ है!');
            }
            try { localStorage.removeItem('procash.loginSkippedAt'); } catch (_) {}
            firebase.auth().signOut().then(() => {
                showToast('info', "लॉगआउट सफल!");
                closeSidebar();
            }).catch((error) => {
                showToast('error', 'लॉगआउट असफल: ' + error.message);
            });
        };
    }

    // 👤 प्रोफ़ाइल एडिट हमेशा clickable रहेगा
    if (profileEditBtn) {
        profileEditBtn.style.display = 'flex';
        profileEditBtn.onclick = () => {
            openProfileModal();
        };
    }

    if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;

                processPendingGroupInvite();

                if (loginBtn) loginBtn.style.display = 'none';
                if (logoutBtn) logoutBtn.style.display = 'flex';
                if (profileEditBtn) profileEditBtn.style.display = 'flex';
                if (userInfo) userInfo.style.display = 'flex';
                if (userName) userName.textContent = user.displayName || 'यूज़र';

                const displayName = user.displayName || 'Google यूज़र';
                if (sidebarUserName) sidebarUserName.textContent = displayName;
                if (sidebarUserStatus) sidebarUserStatus.textContent = user.email || 'Google से लॉगिन';
                if (sidebarAvatar) sidebarAvatar.textContent = getInitial(displayName);

                loadUserExpensesFromFirebase(user.uid);
                listenToAllGroups();
                toggleAccountDeleteCard();
                updateGroupActionButtons();
                Plan.attach(user);
            } else {
                currentUser = null;
                requireLoginOnce();
                stopGroupListeners();
                toggleAccountDeleteCard();
                updateGroupActionButtons();
                Plan.detach();

                if (loginBtn) loginBtn.style.display = 'flex';
                if (logoutBtn) logoutBtn.style.display = 'none';
                if (profileEditBtn) profileEditBtn.style.display = 'flex';
                if (userInfo) userInfo.style.display = 'none';

                if (sidebarUserName) sidebarUserName.textContent = 'गेस्ट यूज़र';
                if (sidebarUserStatus) sidebarUserStatus.textContent = 'लॉगिन नहीं है';
                if (sidebarAvatar) sidebarAvatar.textContent = '👤';
            }
        });
    }
}

// ==========================================
// ☰ SIDEBAR + PROFILE EDIT
// ==========================================
function initSidebar() {
    const menuToggle = document.getElementById('menuToggle');
    const closeBtn = document.getElementById('closeSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const sidebar = document.getElementById('appSidebar');
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');

    if (menuToggle) menuToggle.onclick = openSidebar;
    if (closeBtn) closeBtn.onclick = closeSidebar;
    if (overlay) overlay.onclick = closeSidebar;

    // Sidebar में किसी भी action पर पहले sidebar बंद होगा, फिर action चलेगा।
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            const interactive = e.target.closest('button, a, input, select, textarea, label');
            if (!interactive) return;
            if (interactive.id === 'closeSidebar') return;

            closeSidebar();
        });
    }

    if (backupBtn) {
        backupBtn.onclick = () => {
            if (typeof backupDataToCloud === 'function') {
                backupDataToCloud();
            } else {
                showToast('warning', 'Cloud Backup function अभी उपलब्ध नहीं है।');
            }
        };
    }

    if (restoreBtn) {
        restoreBtn.onclick = () => {
            if (typeof restoreDataFromCloud === 'function') {
                restoreDataFromCloud();
            } else {
                showToast('warning', 'Cloud Restore function अभी उपलब्ध नहीं है।');
            }
        };
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
            closeProfileModal();
        }
    });
}

function openSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
}

function getInitial(name) {
    const clean = String(name || '').trim();
    return clean ? clean.charAt(0).toUpperCase() : '👤';
}

function openProfileModal() {
    if (!currentUser) {
        return showToast('warning', 'प्रोफ़ाइल एडिट करने के लिए पहले लॉग इन करें।');
    }

    const modal = document.getElementById('profileModal');
    const input = document.getElementById('profileNameInput');
    if (!modal || !input) return;

    input.value = currentUser.displayName || '';

    // Sidebar पूरी तरह बंद होने के बाद modal खोलें, ताकि modal sidebar के पीछे न जाए।
    closeSidebar();
    setTimeout(() => {
        modal.style.display = 'flex';
        input.focus();
    }, 180);
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.style.display = 'none';
}

function initProfileEditor() {
    const saveBtn = document.getElementById('saveProfileBtn');
    const closeBtn = document.getElementById('closeProfileModal');
    const modal = document.getElementById('profileModal');
    const profileBox = document.getElementById('sidebarProfile');
    const profileEditBtn = document.getElementById('profileEditBtn');

    // पूरा Profile DIV clickable: avatar/name/status पर tap करने से भी editor खुलेगा
    if (profileBox) {
        profileBox.onclick = (event) => {
            // अंदर का अलग Edit button हो तो उसका click दोबारा trigger न हो
            if (profileEditBtn && profileEditBtn.contains(event.target)) return;
            openProfileModal();
        };
    }

    if (profileEditBtn) {
        profileEditBtn.onclick = (event) => {
            event.stopPropagation();
            openProfileModal();
        };
    }

    if (closeBtn) closeBtn.onclick = closeProfileModal;
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeProfileModal();
        });
    }

    if (saveBtn) {
        saveBtn.onclick = () => {
            if (!currentUser) {
                return showToast('warning', 'पहले लॉग इन करें।');
            }

            const input = document.getElementById('profileNameInput');
            const newName = input ? input.value.trim() : '';

            if (!newName) {
                return showToast('warning', 'नाम खाली नहीं हो सकता!');
            }

            saveBtn.disabled = true;
            currentUser.updateProfile({ displayName: newName })
                .then(() => {
                    const sidebarUserName = document.getElementById('sidebarUserName');
                    const sidebarAvatar = document.getElementById('sidebarAvatar');
                    const userName = document.getElementById('userName');

                    if (sidebarUserName) sidebarUserName.textContent = newName;
                    if (sidebarAvatar) sidebarAvatar.textContent = getInitial(newName);
                    if (userName) userName.textContent = newName;

                    showToast('success', 'प्रोफ़ाइल नाम अपडेट हो गया!');
                    closeProfileModal();
                })
                .catch((error) => {
                    showToast('error', 'प्रोफ़ाइल अपडेट असफल: ' + error.message);
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
        };
    }
}

// ==========================================
// 🔥 FIREBASE & CLOUD BACKUP
// ==========================================
let expenseUnsubscribe = null;
let groupUnsubscribe = null;

function saveExpenseToFirebase(expenseObj) {
    if (typeof db === "undefined" || !currentUser) return;

    db.collection("users")
      .doc(currentUser.uid)
      .collection("expenses")
      .doc(String(expenseObj.id))
      .set({
          id: expenseObj.id,
          desc: expenseObj.desc,
          amount: expenseObj.amount,
          date: expenseObj.date,
          category: expenseObj.category,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
      })
      .catch((error) => {
          console.error('Expense save failed:', error);
          showToast('error', 'Cloud में खर्च सेव नहीं हो पाया।');
      });
}

function deleteExpenseFromFirebase(id) {
    if (typeof db === "undefined" || !currentUser) return;

    db.collection("users")
      .doc(currentUser.uid)
      .collection("expenses")
      .doc(String(id))
      .delete()
      .catch((error) => {
          console.error('Expense delete failed:', error);
          showToast('error', 'Cloud से खर्च हट नहीं पाया।');
      });
}

function loadExpensesFromFirebase() {
    if (typeof db === "undefined" || !currentUser) return;

    if (typeof expenseUnsubscribe === 'function') {
        expenseUnsubscribe();
    }

    expenseUnsubscribe = db.collection("users")
        .doc(currentUser.uid)
        .collection("expenses")
        .onSnapshot((snapshot) => {
            let firebaseExpenses = [];

            snapshot.forEach((doc) => {
                const data = doc.data();
                firebaseExpenses.push({
                    id: data.id || Number(doc.id) || Date.now(),
                    desc: data.desc || '',
                    amount: Number(data.amount) || 0,
                    date: data.date || '',
                    category: data.category || 'अन्य'
                });
            });

            // लॉगिन से पहले जोड़े/बदले/हटाए गए खर्च Cloud में भेजें, ताकि लोकल डेटा न मिटे
            const pending = getUnsynced();
            if (pending.up.length || pending.del.length) {
                const byId = new Map(firebaseExpenses.map(e => [String(e.id), e]));
                expenses.filter(e => pending.up.includes(String(e.id))).forEach(e => {
                    byId.set(String(e.id), e);
                    saveExpenseToFirebase(e);
                });
                pending.del.forEach(id => {
                    byId.delete(String(id));
                    deleteExpenseFromFirebase(id);
                });
                firebaseExpenses = Array.from(byId.values());
                saveUnsynced({ up: [], del: [] });
            }

            expenses = firebaseExpenses;
            localStorage.setItem('expenses', JSON.stringify(expenses));
            renderExpenses();
            updateDashboard();
        }, (error) => {
            console.error('Expense listener failed:', error);
            showToast('error', 'Cloud data लोड नहीं हो पाया।');
        });
}

function loadUserExpensesFromFirebase(uid) {
    if (!uid || !currentUser || currentUser.uid !== uid) return;
    loadExpensesFromFirebase();
}

// ☁️ Cloud Backup: केवल logged-in user के private document में
async function backupDataToCloud() {
    if (!Plan.guard('backup')) return;
    if (typeof db === "undefined" || !currentUser) {
        return showToast('warning', 'Cloud Backup के लिए पहले लॉग इन करें।');
    }

    try {
        const backup = {
            expenses: expenses,
            userIncome: userIncome,
            categoryBudgets: categoryBudgets,
            activeGroup: activeGroup,
            biz: (window.Biz ? Biz.export() : null),
            savedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('users')
            .doc(currentUser.uid)
            .collection('backups')
            .doc('latest')
            .set(backup);

        showToast('success', 'Cloud Backup सफल हो गया!');
    } catch (error) {
        console.error('Backup failed:', error);
        showToast('error', 'Cloud Backup असफल हुआ।');
    }
}

// ☁️ Cloud के खर्च को दी गई सूची से बदलना (Restore के बाद सब कुछ एक जैसा रहे)
async function commitInChunks(ops) {
    for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach(op => op(batch));
        await batch.commit();
    }
}

async function replaceCloudExpenses(list) {
    if (typeof db === "undefined" || !currentUser) return;
    const col = db.collection('users').doc(currentUser.uid).collection('expenses');
    const existing = await col.get();
    const keep = new Set(list.map(e => String(e.id)));
    const ops = [];
    existing.forEach(doc => { if (!keep.has(doc.id)) ops.push(b => b.delete(doc.ref)); });
    list.forEach(e => ops.push(b => b.set(col.doc(String(e.id)), {
        id: e.id,
        desc: e.desc || '',
        amount: Number(e.amount) || 0,
        date: e.date || '',
        category: e.category || 'अन्य',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })));
    await commitInChunks(ops);
}

async function deleteAllCloudData() {
    if (typeof db === "undefined" || !currentUser) return;
    const userRef = db.collection('users').doc(currentUser.uid);
    const existing = await userRef.collection('expenses').get();
    const ops = [];
    existing.forEach(doc => ops.push(b => b.delete(doc.ref)));
    ops.push(b => b.delete(userRef.collection('backups').doc('latest')));
    await commitInChunks(ops);
}

// ☁️ Cloud Restore: केवल logged-in user का latest backup
async function restoreDataFromCloud() {
    if (!Plan.guard('backup')) return;
    if (typeof db === "undefined" || !currentUser) {
        return showToast('warning', 'Cloud Restore के लिए पहले लॉग इन करें।');
    }

    if (!confirm('Restore करने पर अभी का डेटा Cloud Backup से बदल जाएगा। जारी रखें?')) return;

    try {
        const doc = await db.collection('users')
            .doc(currentUser.uid)
            .collection('backups')
            .doc('latest')
            .get();

        if (!doc.exists) {
            return showToast('info', 'कोई Cloud Backup नहीं मिला।');
        }

        const data = doc.data() || {};

        if (Array.isArray(data.expenses)) {
            expenses = data.expenses;
            localStorage.setItem('expenses', JSON.stringify(expenses));
            await replaceCloudExpenses(expenses);
        }

        if (typeof data.userIncome === 'number') {
            userIncome = data.userIncome;
            localStorage.setItem('userIncome', String(userIncome));
        }

        if (data.categoryBudgets && typeof data.categoryBudgets === 'object') {
            categoryBudgets = data.categoryBudgets;
            localStorage.setItem('categoryBudgets', JSON.stringify(categoryBudgets));
        }

        if (data.biz && window.Biz) Biz.import(data.biz);

        if (data.activeGroup) {
            activeGroup = data.activeGroup;
            persistActiveGroup();
        }

        renderExpenses();
        updateDashboard();
        if (typeof showActiveGroupUI === 'function' && activeGroup) showActiveGroupUI();

        showToast('success', 'Cloud Backup Restore हो गया!');
    } catch (error) {
        console.error('Restore failed:', error);
        showToast('error', 'Cloud Restore असफल हुआ।');
    }
}


// ==========================================
// 👥 SECURE GROUP INVITE / SHARE
// ==========================================
function generateInviteToken() {
    const bytes = new Uint8Array(24);
    if (window.crypto && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getCurrentGroupId() {
    return activeGroup && activeGroup.groupId ? activeGroup.groupId : (activeGroup ? activeGroup.name : null);
}

function buildGroupInviteLink() {
    if (!activeGroup || !activeGroup.inviteToken) return null;
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
        join: getCurrentGroupId(),
        token: activeGroup.inviteToken
    });
    return `${base}?${params.toString()}`;
}

async function copyInviteLink(link) {
    try {
        await navigator.clipboard.writeText(link);
        showToast('success', 'Invite link कॉपी हो गई!');
        return true;
    } catch (e) {
        const temp = document.createElement('textarea');
        temp.value = link;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        temp.remove();
        if (copied) showToast('success', 'Invite link कॉपी हो गई!');
        return copied;
    }
}

function initGroupInviteShare() {
    const inviteBtn = document.getElementById('inviteGroupBtn');
    const shareBtn = document.getElementById('shareGroupBtn');

    if (inviteBtn) {
        inviteBtn.onclick = async () => {
            if (!currentUser) return showToast('warning', 'Invite भेजने के लिए पहले लॉग इन करें।');
            if (!activeGroup) return showToast('warning', 'पहले Group बनाएं।');

            if (!activeGroup.inviteToken) {
                activeGroup.inviteToken = generateInviteToken();
                activeGroup.groupId = activeGroup.groupId || activeGroup.name;
                activeGroup.ownerUid = activeGroup.ownerUid || currentUser.uid;
                activeGroup.memberUids = Array.isArray(activeGroup.memberUids) && activeGroup.memberUids.length
                    ? activeGroup.memberUids
                    : [activeGroup.ownerUid];
                await syncGroupToFirebase();
                persistActiveGroup();
            }

            const link = buildGroupInviteLink();
            if (!link) return showToast('error', 'Invite link नहीं बन पाई।');

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: `ProCash Manager — ${activeGroup.name}`,
                        text: `“${activeGroup.name}” Group में जुड़ने के लिए इस लिंक को खोलें।`,
                        url: link
                    });
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: '👤 Group Invite',
                    html: `<p style="font-size:.9rem;">यह लिंक सिर्फ उस व्यक्ति को भेजें जिसे आप Group में जोड़ना चाहते हैं।</p>
                           <input id="groupInviteLinkInput" class="swal2-input" value="${link.replace(/"/g, '&quot;')}" readonly>`,
                    showCancelButton: true,
                    confirmButtonText: '🔗 लिंक कॉपी करें',
                    cancelButtonText: 'बंद करें',
                    preConfirm: () => copyInviteLink(link)
                });
            } else {
                await copyInviteLink(link);
            }
        };
    }

    if (shareBtn) {
        shareBtn.onclick = async () => {
            if (!currentUser) return showToast('warning', 'Share करने के लिए पहले लॉग इन करें।');
            if (!activeGroup) return showToast('warning', 'पहले Group बनाएं।');

            if (!activeGroup.inviteToken) {
                activeGroup.inviteToken = generateInviteToken();
                activeGroup.groupId = activeGroup.groupId || activeGroup.name;
                activeGroup.ownerUid = activeGroup.ownerUid || currentUser.uid;
                activeGroup.memberUids = Array.isArray(activeGroup.memberUids) && activeGroup.memberUids.length
                    ? activeGroup.memberUids
                    : [activeGroup.ownerUid];
                await syncGroupToFirebase();
            }
            const link = buildGroupInviteLink();
            if (!link) return showToast('warning', 'Share link नहीं बन पाई।');

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: `ProCash Manager — ${activeGroup.name}`,
                        text: `“${activeGroup.name}” Group में जुड़ने के लिए इस लिंक को खोलें।`,
                        url: link
                    });
                } catch (e) {
                    if (e && e.name !== 'AbortError') await copyInviteLink(link);
                }
            } else {
                await copyInviteLink(link);
            }
        };
    }
}

async function processPendingGroupInvite() {
    const params = new URLSearchParams(window.location.search);
    let groupId = params.get('join');
    let token = params.get('token');

    const pending = JSON.parse(localStorage.getItem('pendingGroupInvite') || 'null');
    if ((!groupId || !token) && pending) {
        groupId = pending.groupId;
        token = pending.token;
    }
    if (!groupId || !token) return;

    if (!currentUser) {
        localStorage.setItem('pendingGroupInvite', JSON.stringify({ groupId, token }));
        return;
    }

    try {
        const inviteRef = db.collection('groupInvites').doc(token);
        const inviteSnap = await inviteRef.get();

        if (!inviteSnap.exists) throw new Error('INVALID_INVITE');

        const invite = inviteSnap.data() || {};
        if (invite.active !== true || invite.groupId !== groupId) {
            throw new Error('INVALID_INVITE');
        }

        const groupRef = db.collection('groups').doc(groupId);

        await db.runTransaction(async (tx) => {
            const snap = await tx.get(groupRef);
            if (!snap.exists) throw new Error('GROUP_NOT_FOUND');

            const data = snap.data() || {};
            if (data.inviteToken !== token) throw new Error('INVALID_INVITE');

            const memberUids = Array.isArray(data.memberUids) ? [...data.memberUids] : [];
            const members = Array.isArray(data.members) ? [...data.members] : [];

            if (!memberUids.includes(currentUser.uid)) {
                memberUids.push(currentUser.uid);
                members.push(currentUser.displayName || currentUser.email || 'नया सदस्य');

                tx.update(groupRef, {
                    memberUids,
                    members
                });
            }

            activeGroup = {
                ...data,
                groupId: data.groupId || groupId,
                memberUids,
                members
            };
        });

        persistActiveGroup();
        localStorage.removeItem('pendingGroupInvite');
        window.history.replaceState({}, document.title, window.location.pathname);
        listenToGroupSync(getCurrentGroupId());
        showActiveGroupUI();
        showToast('success', 'आप Group में सफलतापूर्वक जुड़ गए!');
    } catch (error) {
        console.error('Group invite failed:', error);
        const messages = {
            GROUP_NOT_FOUND: 'यह Group मौजूद नहीं है।',
            INVALID_INVITE: 'यह Invite link गलत, बंद या पुराना है।'
        };
        showToast('error', messages[error.message] || 'Group में जुड़ना असफल हुआ।');
    }
}

async function syncGroupToFirebase() {
    if (typeof db === "undefined" || !currentUser || !activeGroup) return false;

    const groupId = activeGroup.groupId || activeGroup.name;
    activeGroup.groupId = groupId;
    activeGroup.ownerUid = activeGroup.ownerUid || currentUser.uid;
    activeGroup.memberUids = Array.isArray(activeGroup.memberUids) && activeGroup.memberUids.length
        ? activeGroup.memberUids
        : [activeGroup.ownerUid];
    activeGroup.inviteToken = activeGroup.inviteToken || generateInviteToken();

    try {
        const batch = db.batch();
        const groupRef = db.collection("groups").doc(groupId);
        const inviteRef = db.collection("groupInvites").doc(activeGroup.inviteToken);

        batch.set(groupRef, activeGroup);
        if (activeGroup.ownerUid === currentUser.uid) {
            batch.set(inviteRef, {
                groupId,
                ownerUid: activeGroup.ownerUid,
                active: true
            }, { merge: true });
        }

        await batch.commit();
        persistActiveGroup();
        return true;
    } catch (error) {
        console.error('Group sync failed:', error);
        showToast('error', 'Group save नहीं हुआ। Firebase Rules check करें।');
        return false;
    }
}

// ==========================================
// 👥 MULTI-GROUP: कई ग्रुप सेव करना, बदलना और सबको सिंक रखना
// ==========================================
let myGroups = {};              // groupId -> ग्रुप का डेटा
let creatingGroup = false;      // "नया ग्रुप" फ़ॉर्म खुला है या नहीं
let editingGroupExpenseId = null;
let groupUnsubs = [];

function groupIdOf(g) { return g ? (g.groupId || g.name) : null; }

function loadMyGroups() {
    try { myGroups = JSON.parse(localStorage.getItem('myGroups') || '{}') || {}; } catch (_) { myGroups = {}; }
    if (activeGroup) {
        const id = groupIdOf(activeGroup);
        if (!myGroups[id]) myGroups[id] = activeGroup;
        else activeGroup = myGroups[id];
    }
}

function persistActiveGroup() {
    if (activeGroup) {
        const id = groupIdOf(activeGroup);
        activeGroup.groupId = activeGroup.groupId || id;
        myGroups[id] = activeGroup;
        localStorage.setItem('activeGroup', JSON.stringify(activeGroup));
    } else {
        localStorage.removeItem('activeGroup');
    }
    localStorage.setItem('myGroups', JSON.stringify(myGroups));
    renderGroupSwitcher();
}

function resetGroupExpenseForm() {
    editingGroupExpenseId = null;
    const ids = { d: 'splitDesc', a: 'splitAmount' };
    if (document.getElementById(ids.d)) document.getElementById(ids.d).value = '';
    if (document.getElementById(ids.a)) document.getElementById(ids.a).value = '';
    const addBtn = document.getElementById('addSplitExpenseBtn');
    if (addBtn) addBtn.textContent = 'ग्रुप में खर्च जोड़ें';
    const cancelBtn = document.getElementById('cancelGroupExpenseEditBtn');
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function selectGroup(id) {
    const g = myGroups[id];
    if (!g) return;
    activeGroup = g;
    resetGroupExpenseForm();
    localStorage.setItem('activeGroup', JSON.stringify(activeGroup));
    showActiveGroupUI();
}

function showCreateGroupUI() {
    if (Object.keys(myGroups).length >= 1 && !Plan.guard('groups')) return;
    creatingGroup = true;
    const hasGroups = Object.keys(myGroups).length > 0;
    const set = (id, display) => { const el = document.getElementById(id); if (el) el.style.display = display; };
    set('createGroupBox', 'block');
    set('createGroupTitle', hasGroups ? 'block' : 'none');
    set('cancelCreateGroupBtn', hasGroups ? 'inline-block' : 'none');
    set('splitExpenseForm', 'none');
    set('downloadGroupPdfBtn', 'none');
    const report = document.getElementById('settlementReport');
    if (report) report.innerHTML = '';
    renderGroupSwitcher();
    const nameInput = document.getElementById('groupName');
    if (nameInput && hasGroups) nameInput.focus();
}

function renderGroupSwitcher() {
    const box = document.getElementById('groupSwitcher');
    if (!box) return;
    const list = Object.values(myGroups);
    box.innerHTML = '';
    if (!list.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    const cur = getCurrencySymbol();
    const activeId = creatingGroup ? null : groupIdOf(activeGroup);

    const head = document.createElement('div');
    head.className = 'group-switcher-head';
    head.textContent = `मेरे ग्रुप (${list.length})`;
    box.appendChild(head);

    const row = document.createElement('div');
    row.className = 'group-chip-row';
    box.appendChild(row);

    list.forEach(g => {
        const total = (g.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'group-chip' + (groupIdOf(g) === activeId ? ' active' : '');
        const name = document.createElement('strong');
        name.textContent = g.name;
        const meta = document.createElement('span');
        meta.textContent = `${cur}${fmtMoney(total)} • ${(g.members || []).length} सदस्य • ${(g.expenses || []).length} खर्च`;
        btn.appendChild(name);
        btn.appendChild(meta);
        btn.onclick = () => selectGroup(groupIdOf(g));
        row.appendChild(btn);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'group-chip group-chip-new' + (creatingGroup ? ' active' : '');
    add.textContent = '➕ नया ग्रुप';
    add.onclick = showCreateGroupUI;
    row.appendChild(add);
}

function stopGroupListeners() {
    groupUnsubs.forEach(u => { try { u(); } catch (_) {} });
    groupUnsubs = [];
}

function removeGroupLocally(id) {
    if (!myGroups[id]) return;
    delete myGroups[id];
    if (activeGroup && groupIdOf(activeGroup) === id) activeGroup = null;
    localStorage.setItem('myGroups', JSON.stringify(myGroups));
}

function mergeGroupFromServer(id, data) {
    const merged = {
        ...data,
        groupId: data.groupId || id,
        members: Array.isArray(data.members) ? data.members : [],
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        memberUids: Array.isArray(data.memberUids) ? data.memberUids : (data.ownerUid ? [data.ownerUid] : [])
    };
    myGroups[id] = merged;
    if (activeGroup && groupIdOf(activeGroup) === id) activeGroup = merged;
}

function finalizeGroupSelection() {
    localStorage.setItem('myGroups', JSON.stringify(myGroups));
    const ids = Object.keys(myGroups);

    if (!activeGroup && ids.length && !creatingGroup) {
        selectGroup(ids[0]);
    } else if (!activeGroup && !ids.length) {
        localStorage.removeItem('activeGroup');
        showCreateGroupUI();
    } else if (activeGroup && !creatingGroup) {
        localStorage.setItem('activeGroup', JSON.stringify(activeGroup));
        showActiveGroupUI();
    } else {
        renderGroupSwitcher();
    }
}

function listenToKnownGroupsIndividually() {
    if (typeof db === "undefined" || !currentUser) return;
    Object.keys(myGroups).forEach(id => {
        const unsub = db.collection('groups').doc(id).onSnapshot((doc) => {
            if (!doc.exists) { removeGroupLocally(id); finalizeGroupSelection(); return; }
            const data = doc.data() || {};
            const uid = currentUser.uid;
            const allowed = data.ownerUid === uid || (Array.isArray(data.memberUids) && data.memberUids.includes(uid));
            if (!allowed) return;
            mergeGroupFromServer(id, data);
            finalizeGroupSelection();
        }, (error) => {
            console.error('Group listener failed:', error);
        });
        groupUnsubs.push(unsub);
    });
}

// लॉगिन के बाद उन सभी ग्रुप को सुनना जिनमें यूज़र सदस्य है (नए फ़ोन/लैपटॉप पर भी दिखेंगे)
function listenToAllGroups() {
    if (typeof db === "undefined" || !currentUser) return;
    stopGroupListeners();

    const unsub = db.collection('groups')
        .where('memberUids', 'array-contains', currentUser.uid)
        .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const id = change.doc.id;
                if (change.type === 'removed') removeGroupLocally(id);
                else mergeGroupFromServer(id, change.doc.data() || {});
            });
            finalizeGroupSelection();
        }, (error) => {
            console.error('Groups query failed, per-group listeners इस्तेमाल हो रहे हैं:', error);
            stopGroupListeners();
            listenToKnownGroupsIndividually();
        });
    groupUnsubs.push(unsub);
}

// पुराने कोड से कॉल होने वाला नाम
function listenToGroupSync() { listenToAllGroups(); }

// 🌙 Theme Toggle
function initTheme() {
    const toggleBtn = document.getElementById('toggleThemeBtn');
    const savedTheme = localStorage.getItem('appTheme') || 'dark';

    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        if (toggleBtn) toggleBtn.textContent = '🌙 डार्क';
    } else {
        document.body.classList.add('dark-theme');
        if (toggleBtn) toggleBtn.textContent = '☀️ लाइट';
    }

    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('appTheme', isDark ? 'dark' : 'light');
            toggleBtn.textContent = isDark ? '☀️ लाइट' : '🌙 डार्क';
        };
    }
}

// 🎯 Category Budget System
function initCategoryBudgetSystem() {
    const setLimitBtn = document.getElementById('setCategoryBudgetBtn');
    const categorySelect = document.getElementById('budgetCategorySelect');
    const limitInput = document.getElementById('categoryBudgetLimit');

    if (setLimitBtn) {
        setLimitBtn.onclick = () => {
            const cat = categorySelect.value;
            const limitVal = parseFloat(limitInput.value);

            if (isNaN(limitVal) || limitVal <= 0) {
                return showToast('warning', 'सही बजट राशि दर्ज करें!');
            }

            categoryBudgets[cat] = limitVal;
            localStorage.setItem('categoryBudgets', JSON.stringify(categoryBudgets));
            limitInput.value = '';
            showToast('success', `${cat} लिमिट ₹${limitVal} सेट हो गई!`);
            updateDashboard();
        };
    }
}

function deleteCategoryBudget(categoryName) {
    if (categoryBudgets[categoryName] !== undefined) {
        delete categoryBudgets[categoryName];
        localStorage.setItem('categoryBudgets', JSON.stringify(categoryBudgets));
        showToast('info', `${categoryName} का बजट लिमिट हटा दिया गया`);
        updateDashboard();
    }
}

function checkCategoryBudgetStatus() {
    const alertsDiv = document.getElementById('categoryBudgetAlerts');
    const currency = document.getElementById('currencySymbol') ? document.getElementById('currencySymbol').value : '₹';
    if (!alertsDiv) return;

    alertsDiv.innerHTML = '';
    Object.keys(categoryBudgets).forEach(cat => {
        const limit = categoryBudgets[cat];
        const spent = expenses.filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0);

        let statusText = '';
        if (spent > limit) {
            statusText = `<div style="color:#dc3545; font-weight:bold; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>⚠️ <strong>${escapeHtml(cat)}:</strong> बजट सीमा पार! (${currency}${fmtMoney(spent)}/${currency}${fmtMoney(limit)})</span>
                <button data-cat="${escapeHtml(cat)}" onclick="deleteCategoryBudget(this.dataset.cat)" style="background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:1rem; margin-left:10px;" title="बजट हटाएं">🗑️</button>
            </div>`;
        } else if (spent >= limit * 0.8) {
            statusText = `<div style="color:#ffc107; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>⚡ <strong>${escapeHtml(cat)}:</strong> 80% बजट पूरा (${currency}${fmtMoney(spent)}/${currency}${fmtMoney(limit)})</span>
                <button data-cat="${escapeHtml(cat)}" onclick="deleteCategoryBudget(this.dataset.cat)" style="background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:1rem; margin-left:10px;" title="बजट हटाएं">🗑️</button>
            </div>`;
        } else {
            statusText = `<div style="color:#28a745; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span>🟢 <strong>${escapeHtml(cat)}:</strong> ${currency}${fmtMoney(spent)} / ${currency}${fmtMoney(limit)}</span>
                <button data-cat="${escapeHtml(cat)}" onclick="deleteCategoryBudget(this.dataset.cat)" style="background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:1rem; margin-left:10px;" title="बजट हटाएं">🗑️</button>
            </div>`;
        }
        alertsDiv.innerHTML += statusText;
    });
}

// 🚀 Core Features & Auto Category
function initFeatures() {
    const saveBudgetBtn = document.getElementById('saveBudgetBtn');
    const incomeInput = document.getElementById('incomeInput');
    const currencySelect = document.getElementById('currencySymbol');

    if (userIncome && incomeInput) incomeInput.value = userIncome;
    const savedCurrency = localStorage.getItem('userCurrency');
    if (savedCurrency && currencySelect) currencySelect.value = savedCurrency;

    if (currencySelect) {
        currencySelect.onchange = () => {
            localStorage.setItem('userCurrency', currencySelect.value);
            renderExpenses();
            updateDashboard();
            if (activeGroup) calculateGroupSettlement();
        };
    }

    if (saveBudgetBtn) {
        saveBudgetBtn.onclick = () => {
            const val = parseFloat(incomeInput.value);
            if (!isNaN(val) && val >= 0) {
                userIncome = val;
                localStorage.setItem('userIncome', userIncome);
                updateDashboard();
                showToast('success', 'मासिक आय सेव हो गई!');
            }
        };
    }

    const descInput = document.getElementById('desc');
    if (descInput) {
        descInput.addEventListener('input', (e) => {
            const text = e.target.value.toLowerCase().trim();
            const categorySelect = document.getElementById('category');

            if (!text) { categorySelect.value = 'अन्य'; return; }

            const foodWords = ['rice', 'food', 'dal', 'kirana', 'pizza', 'zomato', 'swiggy', 'tea', 'milk', 'khana', 'hotel', 'chai', 'lunch', 'dinner', 'ration', 'राशन', 'खाना'];
            const travelWords = ['petrol', 'diesel', 'cab', 'auto', 'uber', 'ola', 'bus', 'train', 'ticket', 'fuel', 'yatra', 'पेट्रोल', 'डीजल'];
            const billWords = ['rent', 'electricity', 'recharge', 'wifi', 'mobile', 'bill', 'water', 'किराया', 'बिजली', 'बिल'];
            const shoppingWords = ['shirt', 'pant', 'clothes', 'shoes', 'amazon', 'flipkart', 'कपड़े', 'खरीदारी'];
            const medicalWords = ['medicine', 'doctor', 'dawai', 'clinic', 'दवाई', 'डॉक्टर'];
            const eduWords = ['fee', 'school', 'college', 'book', 'pen', 'tuition', 'फीस', 'किताब'];

            if (foodWords.some(w => text.includes(w))) categorySelect.value = 'खाना';
            else if (travelWords.some(w => text.includes(w))) categorySelect.value = 'यात्रा';
            else if (billWords.some(w => text.includes(w))) categorySelect.value = 'बिल/किराया';
            else if (shoppingWords.some(w => text.includes(w))) categorySelect.value = 'खरीदारी';
            else if (medicalWords.some(w => text.includes(w))) categorySelect.value = 'दवाई';
            else if (eduWords.some(w => text.includes(w))) categorySelect.value = 'शिक्षा';
            else categorySelect.value = 'अन्य';
        });
    }

    if (document.getElementById('searchInput')) document.getElementById('searchInput').oninput = renderExpenses;
    if (document.getElementById('filterCategory')) document.getElementById('filterCategory').onchange = renderExpenses;
    if (document.getElementById('downloadPdfBtn')) document.getElementById('downloadPdfBtn').onclick = generatePDF;
    if (document.getElementById('downloadReportBtn')) document.getElementById('downloadReportBtn').onclick = generateCSV;
    
    if (document.getElementById('downloadGroupPdfBtn')) {
        document.getElementById('downloadGroupPdfBtn').onclick = generateGroupPDF;
    }

    if (document.getElementById('clearAllBtn')) {
        document.getElementById('clearAllBtn').onclick = async () => {
            const cloudNote = currentUser ? '\n(Cloud में सेव खर्च और Backup भी हट जाएँगे।)' : '';
            if (confirm('क्या आप अपना पूरा डेटा और ग्रुप डिलीट करना चाहते हैं?' + cloudNote)) {
                if (currentUser) {
                    try {
                        if (typeof expenseUnsubscribe === 'function') expenseUnsubscribe();
                        await deleteAllCloudData();
                    } catch (error) {
                        console.error('Cloud delete failed:', error);
                        return showToast('error', 'Cloud डेटा हट नहीं पाया। दोबारा कोशिश करें।');
                    }
                }
                expenses = [];
                activeGroup = null;
                userIncome = 0;
                categoryBudgets = {};
                localStorage.clear();
                renderExpenses();
                updateDashboard();
                location.reload();
            }
        };
    }
}

// ✏️ Add & Edit Expense
if (document.getElementById('addExpenseBtn')) {
    document.getElementById('addExpenseBtn').onclick = () => {
        const desc = document.getElementById('desc').value.trim();
        const amount = parseFloat(document.getElementById('amount').value);
        const date = document.getElementById('date').value || todayLocal();
        const category = document.getElementById('category').value;
        const editId = document.getElementById('editExpenseId').value;

        if (!desc || isNaN(amount) || amount <= 0) {
            return showToast('warning', 'विवरण और सही रकम दर्ज करें!');
        }

        let newOrUpdatedExpense;

        if (editId) {
            const index = expenses.findIndex(e => String(e.id) === String(editId));
            if (index !== -1) {
                newOrUpdatedExpense = { id: expenses[index].id, desc, amount, date, category };
                expenses[index] = newOrUpdatedExpense;
                showToast('success', 'खर्च अपडेट हुआ!');
            }
            resetExpenseForm();
        } else {
            newOrUpdatedExpense = { id: Date.now(), desc, amount, date, category };
            expenses.push(newOrUpdatedExpense);
            showToast('success', 'खर्च जोड़ दिया गया!');
        }

        localStorage.setItem('expenses', JSON.stringify(expenses));
        if (newOrUpdatedExpense) {
            if (!currentUser) markUnsyncedUpload(newOrUpdatedExpense.id);
            saveExpenseToFirebase(newOrUpdatedExpense);
        }
        
        document.getElementById('desc').value = '';
        document.getElementById('amount').value = '';
        renderExpenses();
        updateDashboard();
    };
}

if (document.getElementById('cancelEditBtn')) {
    document.getElementById('cancelEditBtn').onclick = resetExpenseForm;
}

function resetExpenseForm() {
    if (document.getElementById('editExpenseId')) document.getElementById('editExpenseId').value = '';
    if (document.getElementById('desc')) document.getElementById('desc').value = '';
    if (document.getElementById('amount')) document.getElementById('amount').value = '';
    if (document.getElementById('formTitle')) document.getElementById('formTitle').textContent = '➕ अपना व्यक्तिगत खर्च जोड़ें';
    if (document.getElementById('addExpenseBtn')) document.getElementById('addExpenseBtn').textContent = 'खर्च जोड़ें';
    if (document.getElementById('cancelEditBtn')) document.getElementById('cancelEditBtn').style.display = 'none';
}

function renderExpenses() {
    const list = document.getElementById('expenseList');
    if (!list) return;

    const search = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : '';
    const filter = document.getElementById('filterCategory') ? document.getElementById('filterCategory').value : 'सभी';
    const currency = document.getElementById('currencySymbol') ? document.getElementById('currencySymbol').value : '₹';

    list.innerHTML = '';

    let filtered = expenses.filter(e => {
        const matchesSearch = e.desc.toLowerCase().includes(search);
        const matchesFilter = filter === 'सभी' || e.category === filter;
        return matchesSearch && matchesFilter;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#777; font-size:0.85rem; padding: 10px;">कोई खर्च नहीं मिला।</p>';
        return;
    }

    filtered.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 12px; margin-bottom:8px; background:#2a2a2a; border-radius:8px; color:#fff; font-size:0.85rem;';
        
        div.innerHTML = `
            <div>
                <strong>${escapeHtml(item.desc)}</strong> (${escapeHtml(item.category)})<br>
                <small style="color:#aaa;">${escapeHtml(item.date)}</small>
            </div>
            <div>
                <span style="color:#dc3545; font-weight:bold;">${currency}${fmtMoney(item.amount)}</span> 
                <button class="edit-btn" style="background:none; border:none; color:#ffc107; cursor:pointer; margin-left:8px;">✏️</button>
                <button class="del-btn" style="background:none; border:none; color:#ff6b6b; cursor:pointer; margin-left:4px;">🗑️</button>
            </div>
        `;

        div.querySelector('.edit-btn').onclick = () => startEditExpense(item.id);
        div.querySelector('.del-btn').onclick = () => deleteExp(item.id);

        list.appendChild(div);
    });
}

function startEditExpense(id) {
    const exp = expenses.find(e => String(e.id) === String(id));
    if (!exp) return;

    document.getElementById('editExpenseId').value = exp.id;
    document.getElementById('desc').value = exp.desc;
    document.getElementById('amount').value = exp.amount;
    document.getElementById('date').value = exp.date;
    document.getElementById('category').value = exp.category;

    document.getElementById('formTitle').textContent = '✏️ खर्च संशोधित करें';
    document.getElementById('addExpenseBtn').textContent = 'अपडेट करें';
    document.getElementById('cancelEditBtn').style.display = 'inline-block';
}

function deleteExp(id) {
    if (confirm('क्या आप इस खर्च को हटाना चाहते हैं?')) {
        expenses = expenses.filter(i => String(i.id) !== String(id));
        localStorage.setItem('expenses', JSON.stringify(expenses));
        if (!currentUser) markUnsyncedDelete(id);
        deleteExpenseFromFirebase(id);
        renderExpenses();
        updateDashboard();
        showToast('info', 'खर्च सफलतापूर्वक हटा दिया गया');
    }
}

function updateDashboard() {
    const currencyElem = document.getElementById('currencySymbol');
    const currency = currencyElem ? currencyElem.value : '₹';
    
    const totalExp = expenses.reduce((sum, i) => sum + i.amount, 0);
    const savings = userIncome - totalExp;

    if (document.getElementById('displayIncome')) document.getElementById('displayIncome').textContent = `${currency}${fmtMoney(userIncome)}`;
    if (document.getElementById('totalExpense')) document.getElementById('totalExpense').textContent = `${currency}${fmtMoney(totalExp)}`;
    
    const savingsElem = document.getElementById('netSavings');
    if (savingsElem) {
        savingsElem.textContent = `${currency}${fmtMoney(savings)}`;
        savingsElem.className = savings >= 0 ? 'text-success' : 'text-danger';
    }

    renderChart();
    checkCategoryBudgetStatus();
}

function renderChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx || typeof Chart === 'undefined') return;

    const categories = ['खाना', 'यात्रा', 'मनोरंजन', 'बिल/किराया', 'खरीदारी', 'दवाई', 'शिक्षा', 'अन्य'];
    const totals = categories.map(cat => expenses.filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0));

    if (myChart) myChart.destroy();

    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: totals,
                backgroundColor: ['#ff6384', '#36a2eb', '#cc65fe', '#ffce56', '#4bc0c0', '#9966ff', '#ff9f40', '#c9cbcf']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

// 👥 GROUP SPLITTER SYSTEM
function initSplitSystem() {
    const createGroupBtn = document.getElementById('createGroupBtn');
    const addSplitBtn = document.getElementById('addSplitExpenseBtn');
    const deleteGroupBtn = document.getElementById('deleteGroupBtn');

    loadMyGroups();
    renderGroupSwitcher();
    if (activeGroup) showActiveGroupUI();
    else if (Object.keys(myGroups).length) selectGroup(Object.keys(myGroups)[0]);

    if (createGroupBtn) {
        createGroupBtn.onclick = () => {
            const name = document.getElementById('groupName').value.trim();
            const membersInput = document.getElementById('groupMembers').value.trim();

            if (!currentUser) return showToast('warning', 'Group बनाने के लिए पहले लॉग इन करें।');
            if (!name || !membersInput) return showToast('warning', 'ग्रुप का नाम और सदस्य दर्ज करें!');
            const members = Array.from(new Map(
                membersInput.split(/[,،]/).map(m => m.trim()).filter(m => m.length > 0).map(m => [m.toLowerCase(), m])
            ).values());
            if (members.length < 2) return showToast('warning', 'कम से कम 2 सदस्य दर्ज करें!');

            const uniqueGroupId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            activeGroup = { groupId: uniqueGroupId, name: name, members: members, memberUids: currentUser ? [currentUser.uid] : [], expenses: [], ownerUid: currentUser ? currentUser.uid : null, inviteToken: generateInviteToken() };
            persistActiveGroup();
            
            syncGroupToFirebase();
            listenToGroupSync(activeGroup.groupId);

            document.getElementById('groupName').value = '';
            document.getElementById('groupMembers').value = '';
            showActiveGroupUI();
            showToast('success', 'ग्रुप बन गया!');
        };
    }

    if (addSplitBtn) {
        addSplitBtn.onclick = () => {
            const desc = document.getElementById('splitDesc').value.trim();
            const amount = parseFloat(document.getElementById('splitAmount').value);
            const paidBy = document.getElementById('paidBySelect').value;

            if (!desc || isNaN(amount) || amount <= 0) return showToast('warning', 'सही रकम दर्ज करें!');
            if (!activeGroup) return showToast('warning', 'पहले ग्रुप बनाएं।');

            if (editingGroupExpenseId !== null) {
                const expense = activeGroup.expenses.find(e => String(e.id) === String(editingGroupExpenseId));
                if (!expense) return showToast('error', 'खर्च नहीं मिला।');
                expense.desc = desc;
                expense.amount = amount;
                expense.paidBy = paidBy;
                editingGroupExpenseId = null;
                showToast('success', 'खर्च अपडेट हो गया!');
            } else {
                activeGroup.expenses.push({ id: Date.now(), desc, amount, paidBy });
                showToast('success', 'खर्च जुड़ गया!');
            }

            persistActiveGroup();
            syncGroupToFirebase();
            document.getElementById('splitDesc').value = '';
            document.getElementById('splitAmount').value = '';
            document.getElementById('addSplitExpenseBtn').textContent = 'ग्रुप में खर्च जोड़ें';
            document.getElementById('cancelGroupExpenseEditBtn').style.display = 'none';
            calculateGroupSettlement();
        };
    }

    const leaveGroupBtn = document.getElementById('leaveGroupBtn');
    if (leaveGroupBtn) {
        leaveGroupBtn.onclick = async () => {
            if (!currentUser || !activeGroup || typeof db === 'undefined') return showToast('warning', 'पहले लॉगिन करें।');
            if (!confirm(`"${activeGroup.name}" ग्रुप छोड़ना चाहते हैं? पुराना हिसाब बाकी सदस्यों के पास रहेगा।`)) return;
            const id = groupIdOf(activeGroup);
            try {
                await db.collection('groups').doc(id).update({
                    memberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
                });
            } catch (error) {
                console.error('Leave group failed:', error);
                return showToast('error', 'ग्रुप छोड़ नहीं पाए। Firebase Rules जाँचें।');
            }
            removeGroupLocally(id);
            const rest = Object.keys(myGroups);
            if (rest.length) selectGroup(rest[0]);
            else showCreateGroupUI();
            showToast('info', 'आपने ग्रुप छोड़ दिया');
        };
    }

    const cancelCreateGroupBtn = document.getElementById('cancelCreateGroupBtn');
    if (cancelCreateGroupBtn) {
        cancelCreateGroupBtn.onclick = () => {
            const ids = Object.keys(myGroups);
            if (!ids.length) return;
            const keep = activeGroup && myGroups[groupIdOf(activeGroup)] ? groupIdOf(activeGroup) : ids[0];
            selectGroup(keep);
        };
    }

    const cancelGroupExpenseEditBtn = document.getElementById('cancelGroupExpenseEditBtn');
    if (cancelGroupExpenseEditBtn) {
        cancelGroupExpenseEditBtn.onclick = () => {
            editingGroupExpenseId = null;
            document.getElementById('splitDesc').value = '';
            document.getElementById('splitAmount').value = '';
            addSplitBtn.textContent = 'ग्रुप में खर्च जोड़ें';
            cancelGroupExpenseEditBtn.style.display = 'none';
        };
    }

    if (deleteGroupBtn) {
        deleteGroupBtn.onclick = async () => {
            if (!currentUser || !activeGroup || activeGroup.ownerUid !== currentUser.uid) {
                return showToast('error', 'सिर्फ Group Owner ही Group हटा सकता है।');
            }
            if (confirm('क्या आप ग्रुप डिलीट करना चाहते हैं?')) {
                if (typeof db !== "undefined" && activeGroup) {
                    try {
                        await db.collection("groups").doc(activeGroup.groupId || activeGroup.name).delete();
                    } catch (error) {
                        console.error('Group delete failed:', error);
                        return showToast('error', 'Group delete नहीं हुआ।');
                    }
                }
                const deletedId = groupIdOf(activeGroup);
                delete myGroups[deletedId];
                activeGroup = null;
                localStorage.removeItem('activeGroup');
                localStorage.setItem('myGroups', JSON.stringify(myGroups));
                const rest = Object.keys(myGroups);
                if (rest.length) selectGroup(rest[0]);
                else showCreateGroupUI();
                showToast('info', 'ग्रुप डिलीट हो गया');
            }
        };
    }
}

function updateGroupActionButtons() {
    const del = document.getElementById('deleteGroupBtn');
    const leave = document.getElementById('leaveGroupBtn');
    if (!del || !leave) return;
    const isMemberOnly = !!(activeGroup && currentUser && activeGroup.ownerUid && activeGroup.ownerUid !== currentUser.uid);
    del.style.display = isMemberOnly ? 'none' : '';
    leave.style.display = isMemberOnly ? '' : 'none';
}

function toggleAccountDeleteCard() {
    const card = document.getElementById('accountDeleteCard');
    if (card) card.style.display = currentUser ? '' : 'none';
}

function showActiveGroupUI() {
    creatingGroup = false;
    ['createGroupTitle', 'cancelCreateGroupBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (document.getElementById('createGroupBox')) document.getElementById('createGroupBox').style.display = 'none';
    const form = document.getElementById('splitExpenseForm');
    const title = document.getElementById('activeGroupName');
    const select = document.getElementById('paidBySelect');

    if (form) form.style.display = 'block';
    if (title) title.textContent = `ग्रुप: ${activeGroup.name}`;

    if (select) {
        select.innerHTML = '';
        activeGroup.members.forEach(member => {
            const option = document.createElement('option');
            option.value = member;
            option.textContent = `${member} ने पैसे दिए`;
            select.appendChild(option);
        });
    }

    if (document.getElementById('downloadGroupPdfBtn')) document.getElementById('downloadGroupPdfBtn').style.display = 'block';
    calculateGroupSettlement();
    renderGroupSwitcher();
    updateGroupActionButtons();
}

// 🧮 ग्रुप का हिसाब: हर सदस्य ने कितना दिया, हिस्सा कितना, और कौन किसे कितना दे
function computeGroupSettlement(group) {
    const members = Array.isArray(group.members) ? group.members : [];
    const expensesList = Array.isArray(group.expenses) ? group.expenses : [];
    const n = members.length || 1;
    const paid = {};
    members.forEach(m => paid[m] = 0);
    let totalPaise = 0;

    expensesList.forEach(e => {
        const paise = Math.round((Number(e.amount) || 0) * 100);
        totalPaise += paise;
        if (!(e.paidBy in paid)) paid[e.paidBy] = 0;
        paid[e.paidBy] += paise;
    });

    const sharePaise = totalPaise / n;
    const rows = Object.keys(paid).map(name => {
        const isMember = members.includes(name);
        const share = isMember ? sharePaise : 0;
        return {
            name,
            paid: paid[name] / 100,
            share: share / 100,
            balance: Math.round(paid[name] - share) / 100
        };
    });

    // सबसे कम लेन-देन में हिसाब चुकाने का तरीका
    const debtors = rows.filter(r => r.balance < -0.004).map(r => ({ name: r.name, amt: Math.round(-r.balance * 100) }));
    const creditors = rows.filter(r => r.balance > 0.004).map(r => ({ name: r.name, amt: Math.round(r.balance * 100) }));
    debtors.sort((a, b) => b.amt - a.amt);
    creditors.sort((a, b) => b.amt - a.amt);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const pay = Math.min(debtors[i].amt, creditors[j].amt);
        if (pay > 0) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: pay / 100 });
        debtors[i].amt -= pay;
        creditors[j].amt -= pay;
        if (debtors[i].amt === 0) i++;
        if (creditors[j].amt === 0) j++;
    }

    return { total: totalPaise / 100, share: sharePaise / 100, rows, transfers };
}

function calculateGroupSettlement() {
    const reportDiv = document.getElementById('settlementReport');
    if (!reportDiv) return;
    
    reportDiv.innerHTML = '';

    if (!activeGroup || activeGroup.expenses.length === 0) {
        reportDiv.innerHTML = '<em>ग्रुप में कोई खर्च नहीं जुड़ा है।</em>';
        return;
    }

    const balances = {};
    activeGroup.members.forEach(m => balances[m] = 0);
    let totalGroupExpense = 0;
    const currency = document.getElementById('currencySymbol') ? document.getElementById('currencySymbol').value : '₹';

    let groupListHtml = `<div style="margin-bottom:12px;"><strong>📝 ग्रुप के खर्च:</strong><br>`;
    activeGroup.expenses.forEach(exp => {
        totalGroupExpense += exp.amount;
        const splitShare = exp.amount / activeGroup.members.length;

        activeGroup.members.forEach(m => {
            if (m === exp.paidBy) balances[m] += (exp.amount - splitShare);
            else balances[m] -= splitShare;
        });

        groupListHtml += `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:0.8rem; background:rgba(255,255,255,0.05); padding:6px 8px; border-radius:4px; margin-top:4px;">
                <span style="flex:1;">🔹 <strong>${escapeHtml(exp.desc)}</strong> (${escapeHtml(exp.paidBy)}): ${currency}${fmtMoney(exp.amount)}</span>
                <span style="display:flex; gap:4px; flex-shrink:0;">
                    <button type="button" class="group-expense-edit-btn" data-expense-id="${String(exp.id)}" style="background:none;border:1px solid #ffc107;color:#ffc107;border-radius:4px;padding:2px 6px;cursor:pointer;">✏️</button>
                    <button type="button" class="group-expense-delete-btn" data-expense-id="${String(exp.id)}" style="background:none;border:1px solid #dc3545;color:#dc3545;border-radius:4px;padding:2px 6px;cursor:pointer;">🗑️</button>
                </span>
            </div>`;
    });
    groupListHtml += `</div><hr style="margin:8px 0; border-color:#555;">`;

    const calc = computeGroupSettlement(activeGroup);
    let settlementHtml = `<strong>कुल खर्च: ${currency}${fmtMoney(calc.total)}</strong><br><br>`;
    calc.rows.forEach(r => {
        const name = escapeHtml(r.name);
        if (r.balance > 0) settlementHtml += `<div style="color:#28a745;">🟢 <strong>${name}</strong> को <strong>${currency}${fmtMoney(r.balance)}</strong> मिलने हैं</div>`;
        else if (r.balance < 0) settlementHtml += `<div style="color:#dc3545;">🔴 <strong>${name}</strong> को <strong>${currency}${fmtMoney(-r.balance)}</strong> देने हैं</div>`;
        else settlementHtml += `<div>⚪ <strong>${name}</strong> का हिसाब बराबर</div>`;
    });
    if (calc.transfers.length) {
        settlementHtml += `<hr style="margin:8px 0; border-color:#555;"><strong>💸 हिसाब कैसे चुकाएँ:</strong>`;
        calc.transfers.forEach(t => {
            settlementHtml += `<div>➡️ <strong>${escapeHtml(t.from)}</strong> → <strong>${escapeHtml(t.to)}</strong>: ${currency}${fmtMoney(t.amount)}</div>`;
        });
    }

    reportDiv.innerHTML = groupListHtml + settlementHtml;

    reportDiv.querySelectorAll('.group-expense-edit-btn').forEach(btn => {
        btn.onclick = () => {
            if (!currentUser) {
                return showToast('error', 'पहले लॉग इन करें।');
            }
            const canEditGroup = activeGroup.ownerUid === currentUser.uid ||
                (Array.isArray(activeGroup.memberUids) && activeGroup.memberUids.includes(currentUser.uid));
            if (!canEditGroup) {
                return showToast('error', 'आप इस Group के सदस्य नहीं हैं।');
            }
            const expense = activeGroup.expenses.find(e => String(e.id) === String(btn.dataset.expenseId));
            if (!expense) return;
            editingGroupExpenseId = expense.id;
            document.getElementById('splitDesc').value = expense.desc;
            document.getElementById('splitAmount').value = expense.amount;
            document.getElementById('paidBySelect').value = expense.paidBy;
            document.getElementById('addSplitExpenseBtn').textContent = '💾 खर्च अपडेट करें';
            document.getElementById('cancelGroupExpenseEditBtn').style.display = 'inline-block';
        };
    });

    reportDiv.querySelectorAll('.group-expense-delete-btn').forEach(btn => {
        btn.onclick = () => {
            if (!currentUser) {
                return showToast('error', 'पहले लॉग इन करें।');
            }
            const canEditGroup = activeGroup.ownerUid === currentUser.uid ||
                (Array.isArray(activeGroup.memberUids) && activeGroup.memberUids.includes(currentUser.uid));
            if (!canEditGroup) {
                return showToast('error', 'आप इस Group के सदस्य नहीं हैं।');
            }
            const expense = activeGroup.expenses.find(e => String(e.id) === String(btn.dataset.expenseId));
            if (!expense || !confirm(`क्या आप "${expense.desc}" का खर्च हटाना चाहते हैं?`)) return;
            activeGroup.expenses = activeGroup.expenses.filter(e => String(e.id) !== String(expense.id));
            if (String(editingGroupExpenseId) === String(expense.id)) editingGroupExpenseId = null;
            persistActiveGroup();
            syncGroupToFirebase();
            calculateGroupSettlement();
            showToast('info', 'ग्रुप का खर्च हटा दिया गया।');
        };
    });
}

// ==========================================
// 📤 CSV / PDF EXPORT
// ==========================================
function csvCell(value) {
    let text = String(value ?? '');
    // Excel में formula चलने से रोकना (=, +, -, @ से शुरू होने वाले टेक्स्ट)
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function generateCSV() {
    if (!Plan.guard('csv')) return;
    if (expenses.length === 0) return showToast('warning', 'कोई डेटा नहीं है!');
    const rows = [['विवरण', 'राशि', 'दिनांक', 'कैटेगरी']];
    expenses.forEach(e => rows.push([e.desc, e.amount, e.date, e.category]));
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    // BOM जोड़ने से Excel में हिंदी सही दिखती है
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, 'Personal_Expense_Report.csv');
    showToast('success', 'CSV डाउनलोड हो गया!');
}

// ---------- PDF इंजन ----------
// jsPDF की डिफ़ॉल्ट फ़ॉन्ट देवनागरी (हिंदी) और ₹ नहीं दिखा सकती।
// इसलिए पेज को ब्राउज़र की अपनी फ़ॉन्ट से बनाकर (canvas) PDF में डालते हैं, जिससे हिंदी सही दिखती है।
const PDF_FONT = '"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Segoe UI","Noto Sans",Arial,sans-serif';

function createReportPages() {
    const W = 794, H = 1123, S = 1.6, M = 44;   // A4 @96dpi, साफ़ पढ़ने लायक और हल्की फ़ाइल
    const C = { brand: '#4f46e5', text: '#1f2937', muted: '#6b7280', line: '#e5e7eb', zebra: '#f8fafc', head: '#eef2ff', red: '#dc2626', green: '#16a34a' };
    const pages = [];
    let ctx, y;

    const font = (size, weight) => `${weight || 'normal'} ${size}px ${PDF_FONT}`;

    function newPage() {
        const canvas = document.createElement('canvas');
        canvas.width = W * S;
        canvas.height = H * S;
        ctx = canvas.getContext('2d');
        ctx.scale(S, S);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.textBaseline = 'alphabetic';
        pages.push(canvas);
        y = M;
    }

    function wrap(text, maxWidth, f) {
        ctx.font = f;
        const out = [];
        String(text ?? '').split(/\r?\n/).forEach(par => {
            let line = '';
            par.split(/(\s+)/).forEach(token => {
                if (!token) return;
                if (ctx.measureText(line + token).width <= maxWidth) { line += token; return; }
                if (line.trim()) out.push(line.trim());
                line = '';
                if (ctx.measureText(token).width <= maxWidth) { line = token.trimStart(); return; }
                // बहुत लंबा शब्द: अक्षर-अक्षर तोड़ें
                for (const ch of token) {
                    if (ctx.measureText(line + ch).width > maxWidth) { out.push(line); line = ''; }
                    line += ch;
                }
            });
            out.push(line.trim());
        });
        return out.length ? out : [''];
    }

    function ensure(space) {
        if (y + space > H - 50) newPage();
    }

    function header(title, subtitle) {
        ctx.fillStyle = C.brand;
        ctx.fillRect(0, 0, W, 92);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(24, 'bold');
        ctx.fillText(title, M, 42);
        ctx.font = font(13);
        ctx.fillText(subtitle, M, 68);
        y = 92 + 26;
    }

    function cards(items) {
        const gap = 12, w = (W - 2 * M - gap * (items.length - 1)) / items.length, h = 64;
        ensure(h + 16);
        items.forEach((it, i) => {
            const x = M + i * (w + gap);
            ctx.fillStyle = '#f5f5ff';
            ctx.strokeStyle = C.line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = C.muted;
            ctx.font = font(12);
            ctx.fillText(it.label, x + 12, y + 22);
            ctx.fillStyle = it.color || C.text;
            ctx.font = font(18, 'bold');
            ctx.fillText(it.value, x + 12, y + 48, w - 24);
        });
        y += h + 22;
    }

    function section(text) {
        ensure(70);
        y += 12;
        ctx.fillStyle = C.text;
        ctx.font = font(16, 'bold');
        ctx.fillText(text, M, y + 4);
        ctx.fillStyle = C.brand;
        ctx.fillRect(M, y + 10, 36, 3);
        y += 30;
    }

    function note(text, color) {
        const lines = wrap(text, W - 2 * M, font(13));
        ensure(lines.length * 20 + 6);
        ctx.fillStyle = color || C.text;
        ctx.font = font(13);
        lines.forEach(l => { ctx.fillText(l, M, y + 14); y += 20; });
        y += 10;
    }

    // columns: [{label, w (0..1 हिस्सा), align:'left'|'right', bold}]
    // rows: हर cell या तो text है या {text, color} या {bar: 0..1}
    function table(columns, rows) {
        const total = W - 2 * M;
        const widths = columns.map(c => c.w * total);
        const pad = 8, lh = 18;

        function drawHead() {
            ctx.fillStyle = C.head;
            ctx.fillRect(M, y, total, 28);
            ctx.fillStyle = C.brand;
            ctx.font = font(12, 'bold');
            let x = M;
            columns.forEach((c, i) => {
                if (c.align === 'right') { ctx.textAlign = 'right'; ctx.fillText(c.label, x + widths[i] - pad, y + 19); ctx.textAlign = 'left'; }
                else ctx.fillText(c.label, x + pad, y + 19);
                x += widths[i];
            });
            y += 28;
        }

        ensure(28 + 40);
        drawHead();

        rows.forEach((row, ri) => {
            const cells = row.map((cell, i) => {
                const obj = (cell && typeof cell === 'object') ? cell : { text: cell };
                if (obj.bar !== undefined) return { ...obj, lines: [''] };
                return { ...obj, lines: wrap(obj.text, widths[i] - 2 * pad, font(13, columns[i].bold ? 'bold' : 'normal')) };
            });
            const rowH = Math.max(...cells.map(c => c.lines.length)) * lh + 12;
            if (y + rowH > H - 50) { newPage(); drawHead(); }

            if (ri % 2 === 1) { ctx.fillStyle = C.zebra; ctx.fillRect(M, y, total, rowH); }
            let x = M;
            cells.forEach((cell, i) => {
                if (cell.bar !== undefined) {
                    const bw = widths[i] - 2 * pad;
                    ctx.fillStyle = '#e5e7eb';
                    ctx.fillRect(x + pad, y + rowH / 2 - 4, bw, 8);
                    ctx.fillStyle = C.brand;
                    ctx.fillRect(x + pad, y + rowH / 2 - 4, Math.max(2, bw * Math.min(1, cell.bar)), 8);
                } else {
                    ctx.fillStyle = cell.color || C.text;
                    ctx.font = font(13, columns[i].bold ? 'bold' : 'normal');
                    cell.lines.forEach((ln, li) => {
                        if (columns[i].align === 'right') { ctx.textAlign = 'right'; ctx.fillText(ln, x + widths[i] - pad, y + 18 + li * lh); ctx.textAlign = 'left'; }
                        else ctx.fillText(ln, x + pad, y + 18 + li * lh);
                    });
                }
                x += widths[i];
            });
            ctx.strokeStyle = C.line;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(M, y + rowH);
            ctx.lineTo(M + total, y + rowH);
            ctx.stroke();
            y += rowH;
        });
        y += 16;
    }

    function finish() {
        const stamp = new Date().toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        pages.forEach((canvas, i) => {
            const c = canvas.getContext('2d');
            c.save();
            c.setTransform(S, 0, 0, S, 0, 0);
            c.strokeStyle = C.line;
            c.beginPath();
            c.moveTo(M, H - 38);
            c.lineTo(W - M, H - 38);
            c.stroke();
            c.fillStyle = C.muted;
            c.font = font(11);
            c.textAlign = 'left';
            c.fillText(`ProCash Manager • ${stamp}`, M, H - 20);
            c.textAlign = 'right';
            c.fillText(`पेज ${i + 1} / ${pages.length}`, W - M, H - 20);
            c.restore();
        });
        return pages;
    }

    newPage();
    return { header, cards, section, note, table, finish };
}

function savePagesAsPdf(pages, fileName, title) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        showToast('error', 'PDF लाइब्रेरी लोड नहीं हुई। इंटरनेट जाँचकर पेज रीलोड करें।');
        return false;
    }
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    pages.forEach((canvas, i) => {
        if (i > 0) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
    });
    if (doc.setProperties) doc.setProperties({ title, creator: 'ProCash Manager' });
    doc.save(fileName);
    return true;
}

function getCurrencySymbol() {
    const el = document.getElementById('currencySymbol');
    return el ? el.value : '₹';
}

async function generatePDF() {
    if (!Plan.guard('pdf')) return;
    if (expenses.length === 0) return showToast('warning', 'कोई डेटा नहीं है!');
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const cur = getCurrencySymbol();
        const sorted = [...expenses].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const first = sorted[0].date || '', last = sorted[sorted.length - 1].date || '';
        const period = first && last ? (first === last ? first : `${first} से ${last}`) : '';

        const r = createReportPages();
        r.header('प्रोकैश मैनेजर', `व्यक्तिगत खर्च रिपोर्ट${period ? '  •  ' + period : ''}`);

        const cards = [{ label: 'कुल खर्च', value: `${cur}${fmtMoney(total)}`, color: C_RED }, { label: 'खर्चों की संख्या', value: String(expenses.length) }];
        if (userIncome > 0) {
            cards.unshift({ label: 'मासिक आय', value: `${cur}${fmtMoney(userIncome)}` });
            const saving = userIncome - total;
            cards.push({ label: 'बचत', value: `${saving < 0 ? '-' : ''}${cur}${fmtMoney(Math.abs(saving))}`, color: saving >= 0 ? C_GREEN : C_RED });
        }
        r.cards(cards);

        // कैटेगरी के हिसाब से
        const byCat = {};
        expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
        const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const limit = categoryBudgets[cat];
            const over = limit && amt > limit;
            return [
                cat,
                { text: `${cur}${fmtMoney(amt)}`, color: over ? C_RED : undefined },
                `${total ? Math.round(amt / total * 100) : 0}%`,
                limit ? { text: `${cur}${fmtMoney(limit)}${over ? ' ⚠' : ''}`, color: over ? C_RED : undefined } : '—',
                { bar: total ? amt / total : 0 }
            ];
        });
        r.section('कैटेगरी के अनुसार खर्च');
        r.table([
            { label: 'कैटेगरी', w: 0.24 }, { label: 'खर्च', w: 0.18, align: 'right' },
            { label: 'हिस्सा', w: 0.10, align: 'right' }, { label: 'बजट लिमिट', w: 0.18, align: 'right' }, { label: '', w: 0.30 }
        ], catRows);

        r.section('सभी खर्च (तारीख के क्रम में)');
        r.table([
            { label: '#', w: 0.07 }, { label: 'तारीख', w: 0.17 }, { label: 'विवरण', w: 0.38 },
            { label: 'कैटेगरी', w: 0.20 }, { label: 'राशि', w: 0.18, align: 'right', bold: true }
        ], sorted.map((e, i) => [String(i + 1), e.date || '—', e.desc, e.category, `${cur}${fmtMoney(e.amount)}`]));

        const ok = savePagesAsPdf(r.finish(), 'Personal_Expense_Report.pdf', 'ProCash Manager - व्यक्तिगत खर्च रिपोर्ट');
        if (ok) showToast('success', 'PDF डाउनलोड हो गया!');
    } catch (error) {
        console.error('PDF error:', error);
        showToast('error', 'PDF बनाने में दिक्कत आई।');
    }
}

async function generateGroupPDF() {
    if (!Plan.guard('pdf')) return;
    if (!activeGroup || !Array.isArray(activeGroup.expenses) || activeGroup.expenses.length === 0) {
        return showToast('warning', 'कोई खर्च नहीं है!');
    }
    try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const cur = getCurrencySymbol();
        const calc = computeGroupSettlement(activeGroup);

        const r = createReportPages();
        r.header(`ग्रुप: ${activeGroup.name}`, `ग्रुप खर्च रिपोर्ट  •  ${activeGroup.members.length} सदस्य`);
        r.cards([
            { label: 'कुल खर्च', value: `${cur}${fmtMoney(calc.total)}` },
            { label: 'सदस्य', value: String(activeGroup.members.length) },
            { label: 'प्रति सदस्य हिस्सा', value: `${cur}${fmtMoney(calc.share)}` }
        ]);
        r.note(`सदस्य: ${activeGroup.members.join(', ')}`, '#6b7280');

        r.section('ग्रुप के खर्च');
        r.table([
            { label: '#', w: 0.07 }, { label: 'विवरण', w: 0.43 },
            { label: 'किसने दिया', w: 0.24 }, { label: 'राशि', w: 0.26, align: 'right', bold: true }
        ], activeGroup.expenses.map((e, i) => [String(i + 1), e.desc, e.paidBy, `${cur}${fmtMoney(e.amount)}`]));

        r.section('सदस्यों का हिसाब');
        r.table([
            { label: 'सदस्य', w: 0.28 }, { label: 'कुल दिया', w: 0.22, align: 'right' },
            { label: 'हिस्सा', w: 0.22, align: 'right' }, { label: 'बैलेंस', w: 0.28, align: 'right', bold: true }
        ], calc.rows.map(row => [
            row.name,
            `${cur}${fmtMoney(row.paid)}`,
            `${cur}${fmtMoney(row.share)}`,
            row.balance > 0 ? { text: `${cur}${fmtMoney(row.balance)} मिलने हैं`, color: C_GREEN }
                : row.balance < 0 ? { text: `${cur}${fmtMoney(-row.balance)} देने हैं`, color: C_RED }
                : 'बराबर'
        ]));

        r.section('हिसाब कैसे चुकाएँ');
        if (calc.transfers.length) {
            r.table([
                { label: 'कौन देगा', w: 0.36 }, { label: 'किसे', w: 0.36 }, { label: 'राशि', w: 0.28, align: 'right', bold: true }
            ], calc.transfers.map(t => [t.from, t.to, `${cur}${fmtMoney(t.amount)}`]));
        } else {
            r.note('सबका हिसाब बराबर है। किसी को कुछ देना नहीं है। ✅');
        }

        const ok = savePagesAsPdf(r.finish(), `${safeFileName(activeGroup.name)}_Group_Report.pdf`, `ProCash Manager - ${activeGroup.name}`);
        if (ok) showToast('success', 'ग्रुप PDF डाउनलोड हो गया!');
    } catch (error) {
        console.error('Group PDF error:', error);
        showToast('error', 'ग्रुप PDF बनाने में दिक्कत आई।');
    }
}

const C_RED = '#dc2626';
const C_GREEN = '#16a34a';

// ==========================================
// 🧨 ACCOUNT DELETE (Play Store की ज़रूरत: ऐप के अंदर से अकाउंट हटाना)
// ==========================================
function initAccountDelete() {
    const btn = document.getElementById('deleteAccountBtn');
    if (btn) btn.onclick = deleteMyAccount;
}

// ऐप खुलते ही लॉग इन न हो तो लॉगिन पेज पर भेजें। छोड़ने के बाद 3 दिन नहीं पूछते; ऑफ़लाइन में कभी नहीं रोकते।
function requireLoginOnce() {
    try {
        if (!navigator.onLine) return;
        const skippedAt = Number(localStorage.getItem('procash.loginSkippedAt') || 0);
        if (Date.now() - skippedAt < 3 * 864e5) return;
        const q = new URLSearchParams(location.search);   // ग्रुप इनवाइट लिंक खोना नहीं चाहिए
        if (q.get('join') && q.get('token')) {
            localStorage.setItem('pendingGroupInvite', JSON.stringify({ groupId: q.get('join'), token: q.get('token') }));
        }
        location.replace('/auth.html?next=/');
    } catch (_) { /* कुछ गड़बड़ हो तो ऐप चलने दें */ }
}

async function deleteMyAccount() {
    if (!currentUser || typeof db === 'undefined') return showToast('warning', 'पहले लॉग इन करें।');
    if (!confirm('आपका अकाउंट और Cloud का सारा डेटा हमेशा के लिए हट जाएगा।\nजो ग्रुप आपने बनाए हैं वे सबके लिए डिलीट हो जाएँगे।\nजारी रखें?')) return;

    const user = currentUser;
    try {
        // सुरक्षा के लिए पहले दोबारा लॉगिन (हटाने से पहले, ताकि आधा काम न रह जाए)
        if (user.providerData.some((p) => p.providerId === 'password')) {
            const pw = prompt('पुष्टि के लिए अपना पासवर्ड लिखें');
            if (!pw) return;
            await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, pw));
        } else {
            await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
        }

        await Plan.cancelNow();

        stopGroupListeners();
        if (typeof expenseUnsubscribe === 'function') expenseUnsubscribe();

        await deleteAllCloudData();

        const groups = await db.collection('groups').where('memberUids', 'array-contains', user.uid).get();
        for (const doc of groups.docs) {
            const data = doc.data() || {};
            try {
                if (data.ownerUid === user.uid) {
                    if (data.inviteToken) { try { await db.collection('groupInvites').doc(data.inviteToken).delete(); } catch (_) {} }
                    await doc.ref.delete();
                } else {
                    await doc.ref.update({ memberUids: firebase.firestore.FieldValue.arrayRemove(user.uid) });
                }
            } catch (e) { console.warn('Group cleanup failed:', doc.id, e); }
        }

        await user.delete();
        localStorage.clear();
        showToast('success', 'अकाउंट डिलीट हो गया');
        setTimeout(() => location.reload(), 1200);
    } catch (error) {
        console.error('Account delete failed:', error);
        if (error && (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request')) {
            return showToast('info', 'डिलीट रद्द हुआ।');
        }
        showToast('error', 'अकाउंट डिलीट नहीं हो पाया। दोबारा कोशिश करें।');
    }
}

// ==========================================
// 🎤 VOICE INPUT (हिंदी बोलकर खर्च जोड़ना)
// ==========================================
function initVoiceInput() {
    const btn = document.getElementById('micBtn');
    if (!btn) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        btn.onclick = () => showToast('warning', 'इस ब्राउज़र में वॉइस इनपुट उपलब्ध नहीं है। Chrome इस्तेमाल करें।');
        return;
    }

    let rec = null;
    let listening = false;

    btn.onclick = () => {
        if (!Plan.guard('voice')) return;
        if (listening && rec) { rec.stop(); return; }

        rec = new SR();
        rec.lang = 'hi-IN';
        rec.interimResults = false;
        rec.maxAlternatives = 1;

        rec.onstart = () => { listening = true; btn.classList.add('listening'); showToast('info', 'बोलिए… जैसे "चाय 50 रुपये"'); };
        rec.onend = () => { listening = false; btn.classList.remove('listening'); };
        rec.onerror = (e) => {
            const msg = e.error === 'not-allowed' ? 'माइक की अनुमति दें।'
                : e.error === 'no-speech' ? 'कुछ सुनाई नहीं दिया।'
                : 'वॉइस इनपुट असफल रहा।';
            showToast('error', msg);
        };
        rec.onresult = (e) => {
            const spoken = (e.results[0][0].transcript || '').trim();
            if (!spoken) return;
            const descEl = document.getElementById('desc');
            const amountEl = document.getElementById('amount');
            const numMatch = spoken.match(/(\d+(?:\.\d+)?)/);
            if (numMatch && amountEl && !amountEl.value) amountEl.value = numMatch[1];
            const cleaned = spoken
                .replace(numMatch ? numMatch[0] : '', '')
                .replace(/(रुपये|रुपए|रूपये|रुपया|रु\.?|₹|rs\.?)/gi, '')
                .replace(/\s+/g, ' ').trim();
            if (descEl) {
                descEl.value = cleaned || spoken;
                descEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };

        try { rec.start(); } catch (_) { /* पहले से चल रहा है */ }
    };
}

// ==========================================
// 🧭 APP PAGE NAVIGATION — modern multi-view UI
// ==========================================
function initAppNavigation() {
    const pages = Array.from(document.querySelectorAll('.app-page'));
    const navItems = Array.from(document.querySelectorAll('[data-page]'));
    if (!pages.length) return;

    const openPage = (pageName) => {
        const target = document.getElementById(`page-${pageName}`) ? pageName : 'dashboard';
        pages.forEach(page => page.classList.toggle('active', page.id === `page-${target}`));

        document.querySelectorAll('.page-nav-item, .sidebar-page-link').forEach(item => {
            item.classList.toggle('active', item.dataset.page === target);
        });

        document.body.dataset.currentPage = target;
        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (target === 'reports') {
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                if (typeof updateDashboard === 'function') updateDashboard();
            }, 80);
        }

        if (typeof closeSidebar === 'function') closeSidebar();
    };

    navItems.forEach(item => {
        item.addEventListener('click', (event) => {
            const target = event.currentTarget.dataset.page;
            if (!target) return;
            event.preventDefault();
            openPage(target);
        });
    });

    // Browser back/forward works like a real app.
    window.addEventListener('popstate', () => {
        openPage(location.hash.replace('#', '') || 'dashboard');
    });

    const initial = location.hash.replace('#', '');
    openPage(document.getElementById(`page-${initial}`) ? initial : 'dashboard');

    // Expose a tiny navigation helper for future features.
    window.ProCashNav = { go: (page) => {
        if (document.getElementById(`page-${page}`)) {
            history.pushState({ page }, '', `#${page}`);
            openPage(page);
        }
    }};
}

/* =========================================================
   ProCash OCR — receipt scanner
   ========================================================= */
async function scanReceipt(file) {
  if (!Plan.guard('ocr')) return;
  if (!file) return;
  const status = document.getElementById("scanStatus");
  const descriptionInput =
    document.getElementById("desc") ||
    document.getElementById("description") ||
    document.getElementById("expenseDescription") ||
    document.querySelector('input[name="description"]');
  const amountInput =
    document.getElementById("amount") ||
    document.getElementById("expenseAmount") ||
    document.querySelector('input[name="amount"]');

  if (status) status.textContent = "रसीद पढ़ी जा रही है…";

  try {
    if (typeof Tesseract === "undefined") {
      throw new Error("OCR library उपलब्ध नहीं है");
    }

    const result = await Tesseract.recognize(file, "eng", {
      logger: m => {
        if (status && typeof m.progress === "number") {
          status.textContent = `रसीद पढ़ी जा रही है… ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const text = (result?.data?.text || "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("रसीद से text नहीं मिला");

    // Prefer currency-labelled values, then common decimal/integer amounts.
    const amountMatches = text.match(
      /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|(?:total|amount|grand\s*total|net\s*amount)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig
    );

    let detectedAmount = "";
    if (amountMatches?.length) {
      const last = amountMatches[amountMatches.length - 1];
      const m = last.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?!.*[0-9])/);
      if (m) detectedAmount = m[1].replace(/,/g, "");
    }

    if (amountInput && detectedAmount) amountInput.value = detectedAmount;
    if (descriptionInput && !descriptionInput.value.trim()) {
      // रसीद की पहली "नाम जैसी" लाइन (दुकान का नाम) को विवरण बनाओ
      const lines = String(result?.data?.text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const shopLine = lines.find(l => /[A-Za-z\u0900-\u097F]{3,}/.test(l) && !/^(total|amount|grand|net|bill|invoice|date|gst|tax)\b/i.test(l));
      descriptionInput.value = (shopLine || "रसीद").replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
    }

    if (status) {
      status.textContent = detectedAmount
        ? `OCR पूरा। राशि ₹${detectedAmount} मिली — सेव करने से पहले जाँच लें।`
        : "OCR पूरा। राशि नहीं मिली — कृपया राशि खुद भरें।";
    }
    return { text, amount: detectedAmount };
  } catch (err) {
    console.error("OCR error:", err);
    if (status) status.textContent = "रसीद पढ़ी नहीं जा सकी। कृपया राशि खुद भरें।";
    return null;
  }
}

function initReceiptScanner() {
  const input =
    document.getElementById("receiptFile") ||
    document.getElementById("receiptInput") ||
    document.getElementById("scanInput") ||
    document.querySelector('input[type="file"][accept*="image"]');

  if (!input || input.dataset.ocrBound === "1") return;
  input.dataset.ocrBound = "1";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) scanReceipt(file);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initReceiptScanner);
} else {
  initReceiptScanner();
}
