const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const os = require('os');
const session = require('express-session');

// --- Dateipfade ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.yml');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const MODELS_PATH = path.join(DATA_DIR, 'models.json');
const CHATS_PATH = path.join(DATA_DIR, 'chats.json');
const GENERAL_PATH = path.join(DATA_DIR, 'general.json');
const ATTEMPTS_PATH = path.join(DATA_DIR, 'attempts.json');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');
const SSL_DIR = path.join(__dirname, 'ssl');

// --- In-Memory Datenstrukturen ---
let config = {};
let users = { users: [] };
let models = {};
let chats = { chats: [] };
let generalConfig = {};
let loginAttempts = { loginAttempts: {} };
let stats = {};

// --- Hilfsfunktionen zum Laden/Speichern von Daten ---
const loadData = (filePath, defaultContent = {}) => {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.trim() === '') {
                console.log(`Datei ${filePath} ist leer, verwende Standardinhalt.`);
                return defaultContent;
            }
            if (filePath.endsWith('.json')) {
                return JSON.parse(content);
            } else if (filePath.endsWith('.yml')) {
                return yaml.load(content);
            }
        }
    } catch (error) {
        console.log(`Fehler beim Laden von ${filePath}:`, error.message);
    }
    console.log(`Datei ${filePath} nicht gefunden oder fehlerhaft, verwende Standardinhalt.`);
    return defaultContent;
};

const saveData = (filePath, data) => {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const content = filePath.endsWith('.json') ? JSON.stringify(data, null, 2) : yaml.dump(data);
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
        console.log(`Fehler beim Speichern von ${filePath}:`, error.message);
    }
};

const now = new Date();
const timeString = now.toLocaleString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin'
});

// Laden aller Daten beim Start
const initializeData = () => {
    generalConfig = loadData(GENERAL_PATH, { "name": "Tontoo AI", "html-titel": "Tontoo AI | %name", "developer": "arlomu", "github": "https://github.com/arlomu" });
    config = loadData(CONFIG_PATH, {
        "main-port": 80, "ollima": { "port": 11434, "host1": "localhost", "host2": "none" },
        "ssl-port": 443, "2er-port": 8080, "host": "localhost",
        "trusted-domains": ["localhost", "127.0.0.1"],
        "sprache": "Deutsch",
        "system-prompt": "# Placeholders: %user-prompt% ...",
        "smtp": {}
        // "message-guard-enabled" removed from defaults
    });
    users = loadData(USERS_PATH, { users: [] });
    models = loadData(MODELS_PATH, {});
    chats = loadData(CHATS_PATH, { chats: [] });
    loginAttempts = loadData(ATTEMPTS_PATH, { loginAttempts: {} });
    stats = loadData(STATS_PATH, { dailyStats: {}, overallStats: { totalTokensUsed: 0, cpuUsageAvg: 0, ramUsageAvg: 0 }, modelStats: {} });

    if (!stats.dailyStats || typeof stats.dailyStats !== 'object') {
        stats.dailyStats = {};
    }
    if (!stats.overallStats || typeof stats.overallStats !== 'object') {
        stats.overallStats = { totalTokensUsed: 0, cpuUsageAvg: 0, ramUsageAvg: 0 };
    }
    if (!stats.modelStats || typeof stats.modelStats !== 'object') {
        stats.modelStats = {};
    }

    console.log('Daten erfolgreich geladen.');
};

initializeData();

// --- Nodemailer Transporter Setup ---
let transporter;
if (config.smtp && config.smtp.host) {
    transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.auth
    });
} else {
    console.log('SMTP-Einstellungen nicht konfiguriert. E-Mail-Funktionen sind deaktiviert.');
}

const sendEmail = async (to, subject, text, html) => {
    // Prüfe ob SMTP aktiviert ist
    if (!transporter || config.smtp?.enabled === false) {
        console.log('E-Mail-Transporter ist nicht konfiguriert oder deaktiviert.');
        return;
    }
    try {
        await transporter.sendMail({
            from: `"Tontoo AI" <${config.smtp.auth.user}>`,
            to,
            subject,
            text,
            html
        });
        console.log(`E-Mail an ${to} gesendet: ${subject}`);
    } catch (error) {
        console.log(`Fehler beim Senden der E-Mail an ${to}:`, error);
    }
};

// --- Automatisches Speichern und Speichern bei Beendigung ---
const saveAllData = () => {
    saveData(USERS_PATH, users);
    saveData(MODELS_PATH, models);
    saveData(CHATS_PATH, chats);
    saveData(ATTEMPTS_PATH, loginAttempts);
    saveData(STATS_PATH, stats);
    console.log('Alle Daten automatisch gespeichert.');
};

setInterval(saveAllData, 60 * 60 * 1000); // Alle 60 Minuten

process.on('SIGINT', async () => {
    console.log('Anwendung wird beendet. Speichere Daten...');
    const adminEmails = users.users.filter(u => u.admin).map(u => u.email);
    if (adminEmails.length > 0) {
        await sendEmail(adminEmails.join(','), 'Tontoo AI: Admin » Server', 'Der Tontoo AI Server wird jetzt heruntergefahren.').catch(console.error);
    }
    saveAllData();
    process.exit();
});

// --- Täglicher Token-Reset und Statistik-Update um 0 Uhr und 12 Uhr ---
const scheduleTokenReset = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    
    const nextNoon = new Date(now);
    if (now.getHours() < 12) {
        nextNoon.setHours(12, 0, 0, 0);
    } else {
        nextNoon.setDate(nextNoon.getDate() + 1);
        nextNoon.setHours(12, 0, 0, 0);
    }

    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const msUntilNoon = nextNoon.getTime() - now.getTime();

    // Midnight reset
    setTimeout(() => {
        updateDailyStatsAndResetTokens();
        setInterval(updateDailyStatsAndResetTokens, 24 * 60 * 60 * 1000); // Täglich wiederholen
    }, msUntilMidnight);

    // Noon reset
    setTimeout(() => {
        updateDailyStatsAndResetTokens();
        setInterval(updateDailyStatsAndResetTokens, 24 * 60 * 60 * 1000); // Täglich wiederholen
    }, msUntilNoon);

    console.log(`Token-Reset geplant für Mitternacht (in ${msUntilMidnight/1000/60} Minuten) und Mittag (in ${msUntilNoon/1000/60} Minuten)`);
};

const updateDailyStatsAndResetTokens = () => {
    const now = new Date();
    const timeString = now.toLocaleString('de-DE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin'
    });
    
    console.log(`Token-Reset durchgeführt um: ${timeString}`);

    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const ramUsage = (totalMemory - freeMemory) / totalMemory;

    stats.overallStats.cpuUsageAvg = parseFloat(cpuUsage.toFixed(2));
    stats.overallStats.ramUsageAvg = parseFloat(ramUsage.toFixed(2));

    users.users.forEach(user => {
        if (user['max-tokens'] !== '--') {
            user['used-tokens'] = 0;
        }
    });

    saveAllData();
    console.log('Tokens zurückgesetzt und Statistiken aktualisiert.');
};

// Starte den Scheduler
scheduleTokenReset();

// --- Express App Setup ---
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'your_super_secret_key_for_sessions_change_this',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// --- Middleware für Trusted Domains ---
app.use((req, res, next) => {
    const host = req.hostname;
    const clientIp = req.ip === '::1' ? '127.0.0.1' : req.ip;

    if (!config['trusted-domains'].includes(host) && !config['trusted-domains'].includes(clientIp)) {
        if (req.accepts('html')) {
            return res.status(403).sendFile(path.join(__dirname, 'public', 'nottrusted.html'));
        }
        return res.status(403).json({ message: 'Domain not allowed.' });
    }
    next();
});

// --- Authentifizierung Middleware ---
const authenticateUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentifizierungstoken fehlt.' });
    }
    const token = authHeader.split(' ')[1];

    const sessionId = Object.keys(req.sessionStore.sessions).find(sId => {
        const sessionData = JSON.parse(req.sessionStore.sessions[sId]);
        return sessionData.token === token && sessionData.userId;
    });

    if (!sessionId) {
        return res.status(401).json({ message: 'Ungültiger oder abgelaufener Token.' });
    }
    req.userId = parseInt(JSON.parse(req.sessionStore.sessions[sessionId]).userId);
    next();
};

const authorizeAdmin = (req, res, next) => {
    const user = users.users.find(u => u.id === req.userId);
    if (!user || !user.admin) {
        return res.status(403).json({ message: 'Zugriff verweigert. Administratorrechte erforderlich.' });
    }
    next();
};

// Für /api/stop
const userGenerationControllers = new Map();

// --- API-Endpunkte ---

// Admin: Konfiguration abrufen
app.get('/api/admin/config', authenticateUser, authorizeAdmin, (req, res) => {
    res.json(config);
});

// Stop-Generation Endpunkt
app.post('/api/stop', authenticateUser, async (req, res) => {
    try {
        const user = users.users.find(u => u.id === req.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'Benutzer nicht gefunden.' });
        }

        // Prüfen ob der Benutzer eine laufende Generation hat
        const controller = userGenerationControllers.get(req.userId);
        
        if (controller) {
            // Generation stoppen
            controller.abort();
            userGenerationControllers.delete(req.userId);
            
            res.json({ 
                message: 'Generation erfolgreich gestoppt.',
                stopped: true
            });
        } else {
            res.json({ 
                message: 'Keine laufende Generation gefunden.',
                stopped: false
            });
        }
    } catch (error) {
        console.error('Fehler beim Stoppen der Generation:', error);
        res.status(500).json({ 
            message: 'Fehler beim Stoppen der Generation',
            error: error.message 
        });
    }
});

// Admin: Konfiguration aktualisieren
app.put('/api/admin/config', authenticateUser, authorizeAdmin, (req, res) => {
    const { updatedConfig } = req.body;
    
    try {
        // Merge mit bestehender Konfiguration
        config = { ...config, ...updatedConfig };
        
        // Speichere die Konfiguration
        saveData(CONFIG_PATH, config);
        
        // E-Mail-Transporter neu konfigurieren wenn SMTP-Einstellungen geändert wurden
        if (updatedConfig.smtp) {
            if (config.smtp && config.smtp.host && config.smtp.enabled !== false) {
                transporter = nodemailer.createTransport({
                    host: config.smtp.host,
                    port: config.smtp.port,
                    secure: config.smtp.secure,
                    auth: config.smtp.auth
                });
            } else {
                transporter = null;
                console.log('SMTP deaktiviert oder nicht konfiguriert.');
            }
        }
        
        res.json({ message: 'Config updated.' });
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Konfiguration:', error);
        res.status(500).json({ message: 'Fehler beim Speichern der Konfiguration.' });
    }
});

// Admin: Modell auf beiden Ollama-Servern verwalten
app.post('/api/admin/models/manage', authenticateUser, authorizeAdmin, async (req, res) => {
    const { action, modelId } = req.body; // action: 'pull' oder 'remove'
    
    if (!action || !modelId) {
        return res.status(400).json({ message: 'Action und ModelId sind erforderlich.' });
    }
    
    const results = [];
    const hosts = [config.ollima.host1, config.ollima.host2].filter(host => host !== 'none');
    for (const host of hosts) {
        try {
            const ollamaHost = host === 'localhost' ? '127.0.0.1' : host;
            const ollamaPort = config.ollima.port;
            
            let endpoint, method, body;
            
            if (action === 'pull') {
                endpoint = '/api/pull';
                method = 'POST';
                body = JSON.stringify({ name: modelId, stream: false });
            } else if (action === 'remove') {
                endpoint = '/api/delete';
                method = 'DELETE';
                body = JSON.stringify({ name: modelId });
            }
            
            const response = await fetch(`http://${ollamaHost}:${ollamaPort}${endpoint}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body
            });
            
            if (response.ok) {
                results.push({ host, success: true, message: `${action} erfolgreich auf ${host}` });
            } else {
                const errorText = await response.text();
                results.push({ host, success: false, message: `Fehler auf ${host}: ${errorText}` });
            }
            
        } catch (error) {
            results.push({ host, success: false, message: `Verbindungsfehler zu ${host}: ${error.message}` });
        }
    }
    
    // Wenn das Modell erfolgreich von mindestens einem Server entfernt wurde, entferne es aus der lokalen Liste
    if (action === 'remove' && results.some(r => r.success)) {
        if (models[modelId]) {
            delete models[modelId];
            saveData(MODELS_PATH, models);
        }
    }
    
    res.json({ results });
});

app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/chat.html');
    } else {
        return res.redirect('/login.html');
    }
});

// Allgemeine Konfiguration für Frontend
app.get('/api/general-config', (req, res) => {
    res.json(generalConfig);
});

// Login-Endpunkt
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip === '::1' ? '127.0.0.1' : req.ip;

    let attemptInfo = loginAttempts.loginAttempts[ip] || { count: 0, lastAttempt: 0, lockedUntil: 0 };

    if (Date.now() < attemptInfo.lockedUntil) {
        return res.status(429).json({ message: `Too many failed attempts. Please wait ${Math.ceil((attemptInfo.lockedUntil - Date.now()) / 1000)} seconds.` });
    }

    const user = users.users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.password)) {
        attemptInfo.count = 0;
        attemptInfo.lockedUntil = 0;
        loginAttempts.loginAttempts[ip] = attemptInfo;
        saveData(ATTEMPTS_PATH, loginAttempts);

        req.session.userId = user.id;
        req.session.token = uuidv4();
        req.session.save();
        
        return res.json({ message: 'Login successful', token: req.session.token, userId: user.id });
    } else {
        attemptInfo.count++;
        attemptInfo.lastAttempt = Date.now();

        if (attemptInfo.count >= 15) {
            attemptInfo.lockedUntil = Date.now() + (25 * 60 * 60 * 1000);
            attemptInfo.message = 'Too many failed attempts. Your account is locked for 25 hours.';
        } else if (attemptInfo.count >= 10) {
            attemptInfo.lockedUntil = Date.now() + (30 * 1000);
            attemptInfo.message = 'Too many failed attempts. Please wait 30 seconds.';
        } else if (attemptInfo.count >= 5) {
            attemptInfo.lockedUntil = Date.now() + (3 * 1000);
            attemptInfo.message = 'Too many failed attempts. Please wait 3 seconds.';
        } else {
            attemptInfo.message = 'Username or password incorrect.';
        }

        loginAttempts.loginAttempts[ip] = attemptInfo;
        saveData(ATTEMPTS_PATH, loginAttempts);
        return res.status(401).json({ message: attemptInfo.message });
    }
});

// Logout-Endpunkt
app.post('/api/logout', authenticateUser, (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.log('Fehler beim Zerstören der Session:', err);
            return res.status(500).json({ message: 'Logout fehlgeschlagen.' });
        }
        res.json({ message: 'Erfolgreich abgemeldet.' });
    });
});

// Benutzerprofil aktualisieren
app.post('/api/user/update-profile', authenticateUser, (req, res) => {
    const { firstName, location, personalPrompt, panelLanguage } = req.body;
    const userIndex = users.users.findIndex(u => u.id === req.userId);

    if (userIndex !== -1) {
        users.users[userIndex].firstName = firstName;
        users.users[userIndex].profile.location = location;
        users.users[userIndex].profile['personal-ai-prompt'] = personalPrompt;
        if (panelLanguage) users.users[userIndex].panelLanguage = panelLanguage;
        saveData(USERS_PATH, users);
        res.json({ message: 'Profile updated successfully.' });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

// Benutzerdaten des aktuellen Benutzers abrufen
app.get('/api/user/me', authenticateUser, (req, res) => {
    const user = users.users.find(u => u.id === req.userId);
    if (user) {
        const { password, ...safeUser } = user;
        res.json(safeUser);
    } else {
        res.status(404).json({ message: 'Benutzer nicht gefunden.' });
    }
});

// Benutzerprofil aktualisieren
app.post('/api/user/update-profile', authenticateUser, (req, res) => {
    const { firstName, location, personalPrompt, panelLanguage } = req.body;
    const userIndex = users.users.findIndex(u => u.id === req.userId);

    if (userIndex !== -1) {
        users.users[userIndex].firstName = firstName;
        users.users[userIndex].profile.location = location;
        users.users[userIndex].profile['personal-ai-prompt'] = personalPrompt;
        if (panelLanguage) users.users[userIndex].panelLanguage = panelLanguage;
        saveData(USERS_PATH, users);
        res.json({ message: 'Profile updated successfully.' });
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

// Passwort ändern
app.post('/api/user/change-password', authenticateUser, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userIndex = users.users.findIndex(u => u.id === req.userId);

    if (userIndex !== -1) {
        const user = users.users[userIndex];
        if (await bcrypt.compare(currentPassword, user.password)) {
            user.password = await bcrypt.hash(newPassword, 10);
            saveData(USERS_PATH, users);
            res.json({ message: 'Password changed successfully.' });
        } else {
            res.status(401).json({ message: 'Current password is incorrect.' });
        }
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

// E-Mail ändern
app.post('/api/user/change-email', authenticateUser, async (req, res) => {
    const { newEmail, password } = req.body;
    const userIndex = users.users.findIndex(u => u.id === req.userId);

    if (userIndex !== -1) {
        const user = users.users[userIndex];
        if (await bcrypt.compare(password, user.password)) {
            user.email = newEmail;
            saveData(USERS_PATH, users);
            res.json({ message: 'Email address changed successfully.' });
        } else {
            res.status(401).json({ message: 'Password is incorrect.' });
        }
    } else {
        res.status(404).json({ message: 'User not found.' });
    }
});

// Passwort zurücksetzen mit Token
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ message: 'Token and new password are required.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const user = users.users.find(u => u.resetToken === token && u.resetTokenExpires > Date.now());

    if (!user) {
        return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    try {
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetToken = null;
        user.resetTokenExpires = null;
        saveData(USERS_PATH, users);
        
        await sendEmail(
            user.email,
            'Ihr Passwort wurde geändert',
            `Hallo ${user.firstName},\n\nIhr Passwort für Tontoo AI wurde erfolgreich geändert.\n\nWenn Sie diese Änderung nicht veranlasst haben, kontaktieren Sie bitte umgehend den Administrator.\n\nMit freundlichen Grüßen,\nIhr Tontoo AI Team`,
            `<p>Hallo ${user.firstName},</p><p>Ihr Passwort für Tontoo AI wurde erfolgreich geändert.</p><p>Wenn Sie diese Änderung nicht veranlasst haben, kontaktieren Sie bitte umgehend den Administrator.</p><p>Mit freundlichen Grüßen,<br>Ihr Tontoo AI Team</p>`
        );

        res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
    } catch (error) {
        console.error('Fehler beim Zurücksetzen des Passworts:', error);
        res.status(500).json({ message: 'Internal server error during password reset.' });
    }
});

// Passwort-Reset anfordern
app.post('/api/request-password-reset', async (req, res) => {
    const { email } = req.body;
    const user = users.users.find(u => u.email === email);

    if (user) {
        const resetToken = uuidv4();
        user.resetToken = resetToken;
        user.resetTokenExpires = Date.now() + 3600000; // 1 Stunde gültig
        saveData(USERS_PATH, users);

        const resetLink = `https://${config.host}:${config['ssl-port']}/passwordreset.html?token=${resetToken}`;
        await sendEmail(
            user.email,
            'Passwort für Tontoo AI zurücksetzen',
            `Hallo ${user.firstName},\n\nSie haben eine Anfrage zum Zurücksetzen Ihres Passworts für Ihr Tontoo AI-Konto gestellt.\n\nBitte klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen: ${resetLink}\n\nDieser Link ist 1 Stunde gültig.\n\nWenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail bitte.\n\nMit freundlichen Grüßen,\nIhr Tontoo AI Team`,
            `<p>Hallo ${user.firstName},</p><p>Sie haben eine Anfrage zum Zurücksetzen Ihres Passworts für Ihr Tontoo AI-Konto gestellt.</p><p>Bitte klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen: <a href="${resetLink}">${resetLink}</a></p><p>Dieser Link ist 1 Stunde gültig.</p><p>Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail bitte.</p><p>Mit freundlichen Grüßen,<br>Ihr Tontoo AI Team</p>`
        );
    }
    res.json({ message: 'If the email address is registered, you will receive a password reset link shortly.' });
});

// --- Chat-Endpunkte ---
app.get('/api/chats', authenticateUser, (req, res) => {
    const userChats = (chats?.chats || []).filter(chat => chat.user_id === req.userId)
                                 .map(chat => ({ 
                                     id: chat.id, 
                                     title: chat.title,
                                     createdAt: chat.createdAt || new Date(0).toISOString()
                                 }));
    res.json(userChats);
});

app.get('/api/chats/:id', authenticateUser, (req, res) => {
    const chatId = req.params.id;
    const chat = (chats?.chats || []).find(c => c.id === chatId && c.user_id === req.userId);
    if (chat) {
        res.json(chat);
    } else {
        res.status(404).json({ message: 'Chat not found.' });
    }
});

// Websearch-Endpunkt
app.post('/api/websearch', authenticateUser, async (req, res) => {
    let aiFullResponse = '';
    let tokensUsed = 0;
    let durationMs = 0;
    let abortController = null;
    const currentMessageId = `temp_${uuidv4()}`; // Temporäre ID für den Loading-Status
    let currentChat = null; // Initialisiere currentChat hier

    try {
        const { message, model } = req.body;
        let chatId = req.headers['x-chat-id'] || null;
        const user = users.users.find(u => u.id === req.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const maxTokens = user['max-tokens'] === '--' ? Infinity : parseInt(user['max-tokens']);
        if (user['used-tokens'] >= maxTokens) {
            return res.status(403).json({ message: 'Daily token limit reached.' });
        }

        currentChat = chats.chats.find(c => c.id === chatId && c.user_id === req.userId);
        let isNewChat = false;
        
        if (!currentChat) {
            chatId = uuidv4();
            currentChat = {
                id: chatId,
                user_id: user.id,
                title: message.substring(0, 15) + (message.length > 15 ? '...' : ''),
                messages: [],
                createdAt: new Date().toISOString()
            };
            chats.chats.push(currentChat);
            isNewChat = true;
        }

        currentChat.messages.push({
            id: uuidv4(),
            sender: 'user',
            content: message
        });
        saveData(CHATS_PATH, chats);

        abortController = new AbortController();
        userGenerationControllers.set(req.userId, abortController);

        const ollamaHost = config.ollama.host1 === 'localhost' ? '127.0.0.1' : config.ollama.host1;
        const ollamaPort = config.ollama.port;
        const ollamaModel = model && models[model] ? model : Object.keys(models)[0] || 'llama3';

        // System-Prompt für Suchbegriffe
        const websearchPrompt = `Du bist ein Generator für Suchbegriffe. Basierend auf der Eingabe des Nutzers, generiere ein JSON-Objekt mit genau drei relevanten Suchbegriffen und dem verwendeten Modell. Die Ausgabe muss exakt diesem Format entsprechen und darf nur das JSON-Objekt enthalten, ohne zusätzlichen Text oder Erklärungen:
{
    "suchworter": ["begriff1", "begriff2", "begriff3"],
    "model": "${ollamaModel}"
}
Beispiel für die Eingabe "Apfel":
{
    "suchworter": ["Äpfel", "Apfelbaum", "Apfelkuchen"],
    "model": "${ollamaModel}"
}
Nutzer-Eingabe: ${message}`;

        const ollamaMessages = [
            { role: 'system', content: websearchPrompt },
            { role: 'user', content: message }
        ];

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        });

        // Temporäre Nachricht für Websearch-Loading hinzufügen
        currentChat.messages.push({
            id: currentMessageId,
            sender: 'ai',
            content: 'Websearch läuft...',
            isWebsearchPending: true
        });
        saveData(CHATS_PATH, chats);

        const startTime = process.hrtime.bigint();

        // Schritt 1: Suchbegriffe von Ollama generieren
        const searchTermResponse = await fetch(`http://${ollamaHost}:${ollamaPort}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: false
            }),
            signal: abortController.signal
        });

        if (!searchTermResponse.ok) {
            const errorText = await searchTermResponse.text();
            throw new Error(`Ollama API error: ${searchTermResponse.status} - ${errorText}`);
        }

        const searchTermData = await searchTermResponse.json();
        let searchTerms;
        try {
            if (!searchTermData.message || !searchTermData.message.content) {
                throw new Error('Ollama response is empty or missing message content');
            }
            console.log('Ollama search terms response (raw):', searchTermData.message.content); // Debugging-Log

            // Markdown-Markierungen entfernen
            let cleanedResponse = searchTermData.message.content
                .replace(/```json\n|\n```/g, '') // Entfernt ```json und ```
                .replace(/```/g, '') // Entfernt verbleibende ```
                .trim();
            console.log('Cleaned Ollama response:', cleanedResponse); // Debugging-Log

            searchTerms = JSON.parse(cleanedResponse);
            if (!searchTerms.suchworter || !Array.isArray(searchTerms.suchworter) || searchTerms.suchworter.length !== 3 || !searchTerms.model) {
                throw new Error('Ollama response does not match expected format: Must contain exactly 3 search terms and a model');
            }
        } catch (e) {
            console.error('Invalid search terms format from Ollama:', e.message, 'Response:', searchTermData.message?.content || 'No content');
            throw new Error(`Invalid search terms format from Ollama: ${e.message}`);
        }

        console.log('Final search terms sent to Websearch API:', searchTerms); // Debugging-Log

        // Schritt 2: Suchbegriffe an localhost:53564 senden
        const websearchResponse = await fetch('http://localhost:53564', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchTerms),
            signal: abortController.signal
        });

        if (!websearchResponse.ok) {
            const errorText = await websearchResponse.text();
            throw new Error(`Websearch API error: ${websearchResponse.status} - ${errorText}`);
        }

        const websearchResult = await websearchResponse.json();
        const { zusammenfassung, quellen } = websearchResult;

        console.log('Websearch result quellen:', quellen); // Debugging-Log für Quellen

        // Temporäre Nachricht entfernen
        currentChat.messages = currentChat.messages.filter(msg => msg.id !== currentMessageId);
        saveData(CHATS_PATH, chats);

        // Schritt 3: Finale AI-Antwort mit normalem System-Prompt generieren
        const systemPrompt = config['system-prompt']
            .replace('%user-prompt%', user.profile['personal-ai-prompt'] || '')
            .replace('%user-name%', user.firstName || 'User')
            .replace('%user-location%', user.profile.location || 'unbekannt')
            .replace('%model%', ollamaModel)
            .replace('%sprache%', config.sprache)
            .replace('%time%', new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));

        const finalMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${message}\n\nWebsearch Zusammenfassung: ${zusammenfassung}` }
        ];

        const ollamaResponse = await fetch(`http://${ollamaHost}:${ollamaPort}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                messages: finalMessages,
                stream: true
            }),
            signal: abortController.signal
        });

        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text();
            throw new Error(`Ollama API error: ${ollamaResponse.status} - ${errorText}`);
        }

        const reader = ollamaResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            // Websearch-Ergebnisse (Quellen) sofort senden
            res.write(JSON.stringify({
                type: 'websearch',
                websearchResults: { quellen }
            }) + '\n');
            if (typeof res.flush === 'function') res.flush();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.message && data.message.content) {
                            aiFullResponse += data.message.content;
                            res.write(JSON.stringify({
                                type: 'token',
                                token: data.message.content,
                                done: data.done || false
                            }) + '\n');
                            if (typeof res.flush === 'function') res.flush();
                        }

                        if (data.done && data.prompt_eval_count && data.eval_count) {
                            tokensUsed = data.prompt_eval_count + data.eval_count;
                        }
                    } catch (parseError) {
                        console.log('Parse error in line:', line, 'Error:', parseError.message);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        const endTime = process.hrtime.bigint();
        durationMs = Number(endTime - startTime) / 1_000_000;

        // Finale Nachricht mit Websearch-Ergebnissen speichern
        currentChat.messages.push({
            id: uuidv4(),
            sender: 'ai',
            content: aiFullResponse,
            tokens: tokensUsed,
            time: (durationMs / 1000).toFixed(2),
            websearchResults: { quellen }
        });
        
        user['used-tokens'] = (user['used-tokens'] || 0) + tokensUsed;
        stats.overallStats.totalTokensUsed = (stats.overallStats.totalTokensUsed || 0) + tokensUsed;
        const today = new Date().toISOString().slice(0, 10);
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { totalTokensUsed: 0 };
        }
        stats.dailyStats[today].totalTokensUsed += tokensUsed;

        saveData(CHATS_PATH, chats);
        saveData(USERS_PATH, users);
        saveData(STATS_PATH, stats);

        res.write(JSON.stringify({ 
            type: 'end', 
            tokens: tokensUsed, 
            time: (durationMs / 1000).toFixed(2), 
            chatId: chatId,
            isNewChat: isNewChat
        }) + '\n');
        
        res.end();

    } catch (error) {
        if (error.name === 'AbortError') {
            if (!res.headersSent) {
                return res.status(499).json({ 
                    type: 'aborted', 
                    message: 'Generation abgebrochen' 
                });
            }
        } else {
            console.error('Websearch error:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                });
            } else {
                res.write(JSON.stringify({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                }) + '\n');
                res.end();
            }
        }
    } finally {
        if (abortController) {
            userGenerationControllers.delete(req.userId);
        }
        // Temporäre Nachricht entfernen, wenn currentChat definiert ist
        if (currentChat) {
            currentChat.messages = currentChat.messages.filter(msg => msg.id !== currentMessageId);
            saveData(CHATS_PATH, chats);
        }
    }
});

// Deepsearch-Endpunkt
app.post('/api/deepsearch', authenticateUser, async (req, res) => {
    let aiFullResponse = '';
    let tokensUsed = 0;
    let durationMs = 0;
    let abortController = null;
    const currentMessageId = `temp_${uuidv4()}`; // Temporäre ID für den Loading-Status
    let currentChat = null;

    try {
        const { message, model } = req.body;
        let chatId = req.headers['x-chat-id'] || null;
        const user = users.users.find(u => u.id === req.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const maxTokens = user['max-tokens'] === '--' ? Infinity : parseInt(user['max-tokens']);
        if (user['used-tokens'] >= maxTokens) {
            return res.status(403).json({ message: 'Daily token limit reached.' });
        }

        currentChat = chats.chats.find(c => c.id === chatId && c.user_id === req.userId);
        let isNewChat = false;
        
        if (!currentChat) {
            chatId = uuidv4();
            currentChat = {
                id: chatId,
                user_id: user.id,
                title: message.substring(0, 15) + (message.length > 15 ? '...' : ''),
                messages: [],
                createdAt: new Date().toISOString()
            };
            chats.chats.push(currentChat);
            isNewChat = true;
        }

        currentChat.messages.push({
            id: uuidv4(),
            sender: 'user',
            content: message
        });
        saveData(CHATS_PATH, chats);

        abortController = new AbortController();
        userGenerationControllers.set(req.userId, abortController);

        const ollamaHost = config.ollama.host1 === 'localhost' ? '127.0.0.1' : config.ollama.host1;
        const ollamaPort = config.ollama.port;
        const ollamaModel = model && models[model] ? model : Object.keys(models)[0] || 'llama3';

        // Custom System-Prompt für Deepsearch: Generiere nur 1 Stichwort
        const deepsearchPrompt = `Du bist ein Stichwort-Extraktor für Deepsearch. Basierend auf der Eingabe des Nutzers, extrahiere genau ein zentrales Stichwort und generiere ein JSON-Objekt mit diesem Stichwort und dem verwendeten Modell. Die Ausgabe muss exakt diesem Format entsprechen und darf nur das JSON-Objekt enthalten, ohne zusätzlichen Text oder Erklärungen:
{
    "stichwort": "zentralesStichwort",
    "model": "${ollamaModel}"
}
Beispiel für die Eingabe "Gebe mir Infos über die neuesten KIs die es gibt":
{
    "stichwort": "neueste KI",
    "model": "${ollamaModel}"
}
Nutzer-Eingabe: ${message}`;

        const ollamaMessages = [
            { role: 'system', content: deepsearchPrompt },
            { role: 'user', content: message }
        ];

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        });

        // Temporäre Nachricht für Deepsearch-Loading hinzufügen
        currentChat.messages.push({
            id: currentMessageId,
            sender: 'ai',
            content: 'Deepsearch läuft...',
            isDeepsearchPending: true
        });
        saveData(CHATS_PATH, chats);

        const startTime = process.hrtime.bigint();

        // Schritt 1: Stichwort von Ollama generieren
        const keywordResponse = await fetch(`http://${ollamaHost}:${ollamaPort}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: false
            }),
            signal: abortController.signal
        });

        if (!keywordResponse.ok) {
            const errorText = await keywordResponse.text();
            throw new Error(`Ollama API error: ${keywordResponse.status} - ${errorText}`);
        }

        const keywordData = await keywordResponse.json();
        let keywordTerms;
        try {
            if (!keywordData.message || !keywordData.message.content) {
                throw new Error('Ollama response is empty or missing message content');
            }
            console.log('Ollama keyword response (raw):', keywordData.message.content);

            // Markdown-Markierungen entfernen
            let cleanedResponse = keywordData.message.content
                .replace(/```json\n|\n```/g, '')
                .replace(/```/g, '')
                .trim();
            console.log('Cleaned Ollama keyword response:', cleanedResponse);

            keywordTerms = JSON.parse(cleanedResponse);
            if (!keywordTerms.stichwort || typeof keywordTerms.stichwort !== 'string' || !keywordTerms.model) {
                throw new Error('Ollama response does not match expected format: Must contain exactly 1 keyword and a model');
            }
        } catch (e) {
            console.error('Invalid keyword format from Ollama:', e.message, 'Response:', keywordData.message?.content || 'No content');
            throw new Error(`Invalid keyword format from Ollama: ${e.message}`);
        }

        console.log('Final keyword sent to Deepsearch API:', keywordTerms);

        // Schritt 2: Stichwort an localhost:6456 senden (ohne Timeout)
        const deepsearchResponse = await fetch('http://localhost:6456', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keywordTerms)
        });

        if (!deepsearchResponse.ok) {
            const errorText = await deepsearchResponse.text();
            throw new Error(`Deepsearch API error: ${deepsearchResponse.status} - ${errorText}`);
        }

        const deepsearchResult = await deepsearchResponse.json();
        let { zusammenfassung, quellen } = deepsearchResult;

        // Validierung und Bereinigung
        if (!zusammenfassung) {
            console.warn('DeepSearch: Keine Zusammenfassung erhalten, Fallback wird verwendet');
            zusammenfassung = 'Keine Zusammenfassung verfügbar.';
        }
        quellen = quellen ? quellen.filter(url => url && typeof url === 'string' && url.startsWith('http')) : [];
        console.log('Deepsearch result quellen (nach Filter):', quellen);

        // Temporäre Nachricht entfernen
        currentChat.messages = currentChat.messages.filter(msg => msg.id !== currentMessageId);
        saveData(CHATS_PATH, chats);

        // Schritt 3: Finale AI-Antwort mit normalem System-Prompt generieren
        const systemPrompt = config['system-prompt']
            .replace('%user-prompt%', user.profile['personal-ai-prompt'] || '')
            .replace('%user-name%', user.firstName || 'User')
            .replace('%user-location%', user.profile.location || 'unbekannt')
            .replace('%model%', ollamaModel)
            .replace('%sprache%', config.sprache)
            .replace('%time%', new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));

        const finalMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${message}\n\nDeepsearch Zusammenfassung: ${zusammenfassung}` }
        ];

        const ollamaResponse = await fetch(`http://${ollamaHost}:${ollamaPort}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                messages: finalMessages,
                stream: true
            }),
            signal: abortController.signal
        });

        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text();
            throw new Error(`Zweite Ollama API-Anfrage fehlgeschlagen: ${ollamaResponse.status} - ${errorText}`);
        }

        const reader = ollamaResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            // Deepsearch-Ergebnisse (Quellen) sofort senden
            res.write(JSON.stringify({
                type: 'deepsearch',
                deepsearchResults: { quellen }
            }) + '\n');
            if (typeof res.flush === 'function') res.flush();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.message && data.message.content) {
                            aiFullResponse += data.message.content;
                            res.write(JSON.stringify({
                                type: 'token',
                                token: data.message.content,
                                done: data.done || false
                            }) + '\n');
                            if (typeof res.flush === 'function') res.flush();
                        }

                        if (data.done && data.prompt_eval_count && data.eval_count) {
                            tokensUsed = data.prompt_eval_count + data.eval_count;
                        }
                    } catch (parseError) {
                        console.log('Parse error in line:', line, 'Error:', parseError.message);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        const endTime = process.hrtime.bigint();
        durationMs = Number(endTime - startTime) / 1_000_000;

        // Finale Nachricht mit Deepsearch-Ergebnissen speichern
        currentChat.messages.push({
            id: uuidv4(),
            sender: 'ai',
            content: aiFullResponse,
            tokens: tokensUsed,
            time: (durationMs / 1000).toFixed(2),
            deepsearchResults: { quellen }
        });
        
        user['used-tokens'] = (user['used-tokens'] || 0) + tokensUsed;
        stats.overallStats.totalTokensUsed = (stats.overallStats.totalTokensUsed || 0) + tokensUsed;
        const today = new Date().toISOString().slice(0, 10);
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { totalTokensUsed: 0 };
        }
        stats.dailyStats[today].totalTokensUsed += tokensUsed;

        saveData(CHATS_PATH, chats);
        saveData(USERS_PATH, users);
        saveData(STATS_PATH, stats);

        res.write(JSON.stringify({ 
            type: 'end', 
            tokens: tokensUsed, 
            time: (durationMs / 1000).toFixed(2), 
            chatId: chatId,
            isNewChat: isNewChat
        }) + '\n');
        
        res.end();

    } catch (error) {
        if (error.name === 'AbortError') {
            if (!res.headersSent) {
                return res.status(499).json({ 
                    type: 'aborted', 
                    message: 'Generation abgebrochen' 
                });
            }
        } else {
            console.error('Deepsearch error:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                });
            } else {
                res.write(JSON.stringify({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                }) + '\n');
                res.end();
            }
        }
    } finally {
        if (abortController) {
            userGenerationControllers.delete(req.userId);
        }
        if (currentChat) {
            currentChat.messages = currentChat.messages.filter(msg => msg.id !== currentMessageId);
            saveData(CHATS_PATH, chats);
        }
    }
});

app.post('/api/chats/:id/rename', authenticateUser, (req, res) => {
    const chatId = req.params.id;
    let { title } = req.body;
    title = title.substring(0, 15) + (title.length > 15 ? '...' : '');

    if (!chats.chats) chats.chats = [];
    
    const chatIndex = chats.chats.findIndex(c => c.id === chatId && c.user_id === req.userId);
    if (chatIndex !== -1) {
        chats.chats[chatIndex].title = title;
        saveData(CHATS_PATH, chats);
        res.json({ message: 'Chat renamed successfully.' });
    } else {
        res.status(404).json({ message: 'Chat not found.' });
    }
});

app.delete('/api/chats/:id', authenticateUser, (req, res) => {
    const chatId = req.params.id;
    if (!chats.chats) chats.chats = [];
    
    const initialLength = chats.chats.length;
    chats.chats = chats.chats.filter(c => !(c.id === chatId && c.user_id === req.userId));
    if (chats.chats.length < initialLength) {
        saveData(CHATS_PATH, chats);
        res.json({ message: 'Chat deleted successfully.' });
    } else {
        res.status(404).json({ message: 'Chat not found.' });
    }
});

// NEU: Endpunkt, um verfügbare Modelle für den Chat zu holen
app.get('/api/models', authenticateUser, (req, res) => {
    res.json(models);
});

// Chat-Nachricht senden und Ollama-Antwort streamen
app.post('/api/chat/send', authenticateUser, async (req, res) => {
    let aiFullResponse = '';
    let tokensUsed = 0;
    let durationMs = 0;
    let abortController = null;

    try {
        const { message, model } = req.body;
        let chatId = req.headers['x-chat-id'] || null;
        const user = users.users.find(u => u.id === req.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const maxTokens = user['max-tokens'] === '--' ? Infinity : parseInt(user['max-tokens']);
        if (user['used-tokens'] >= maxTokens) {
            return res.status(403).json({ message: 'Daily token limit reached.' });
        }

        // Message-Guard entfernt: direkt weiter zur Streaming-Anfrage

        let currentChat = chats.chats.find(c => c.id === chatId && c.user_id === req.userId);
        let isNewChat = false;
        
        if (!currentChat) {
            chatId = uuidv4();
            currentChat = {
                id: chatId,
                user_id: user.id,
                title: message.substring(0, 15) + (message.length > 15 ? '...' : ''),
                messages: [],
                createdAt: new Date().toISOString()
            };
            chats.chats.push(currentChat);
            isNewChat = true;
        }

        currentChat.messages.push({
            id: uuidv4(),
            sender: 'user',
            content: message
        });
        saveData(CHATS_PATH, chats);

        // AbortController für diese Generation erstellen
        abortController = new AbortController();
        userGenerationControllers.set(req.userId, abortController);

        const ollamaHost = config.ollama.host1 === 'localhost' ? '127.0.0.1' : config.ollama.host1;
        const ollamaPort = config.ollama.port;
        const ollamaModel = model && models[model] ? model : Object.keys(models)[0] || 'llama3';

        const systemPrompt = config['system-prompt']
            .replace('%user-prompt%', user.profile['personal-ai-prompt'] || '')
            .replace('%user-name%', user.firstName || 'User')
            .replace('%user-location%', user.profile.location || 'unbekannt')
            .replace('%model%', ollamaModel)
            .replace('%sprache%', config.sprache)
            .replace('%time%', timeString);

        const ollamaMessages = [
            { role: 'system', content: systemPrompt },
            ...currentChat.messages.map(msg => ({ 
                role: msg.sender === 'user' ? 'user' : 'assistant', 
                content: msg.content 
            }))
        ];

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no' // Hint für reverse-proxies wie nginx: kein Buffering
            // Entferne 'Connection: keep-alive'
        });

        const startTime = process.hrtime.bigint();
        
        const ollamaResponse = await fetch(`http://${ollamaHost}:${ollamaPort}/api/chat`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: true
            }),
            signal: abortController.signal // Signal für Abbruch hinzufügen
        });
        
        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text();
            throw new Error(`Ollama API error: ${ollamaResponse.status} - ${errorText}`);
        }

        // Only use .body.getReader() here (not in guard check!)
        const reader = ollamaResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.message && data.message.content) {
                            aiFullResponse += data.message.content;
                            res.write(JSON.stringify({
                                type: 'token',
                                token: data.message.content,
                                done: data.done || false
                            }) + '\n');
                            // Direkt nach jedem Write flushen
                            if (typeof res.flush === 'function') res.flush();
                        }

                        if (data.done && data.prompt_eval_count && data.eval_count) {
                            tokensUsed = data.prompt_eval_count + data.eval_count;
                        }
                    } catch (parseError) {
                        console.log('Parse error in line:', line, 'Error:', parseError.message);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        const endTime = process.hrtime.bigint();
        durationMs = Number(endTime - startTime) / 1_000_000;

        if (isNewChat) {
            currentChat = chats.chats.find(c => c.id === chatId && c.user_id === req.userId);
        }
        
        currentChat.messages.push({
            id: uuidv4(),
            sender: 'ai',
            content: aiFullResponse,
            tokens: tokensUsed,
            time: (durationMs / 1000).toFixed(2)
        });
        
        user['used-tokens'] = (user['used-tokens'] || 0) + tokensUsed;
        stats.overallStats.totalTokensUsed = (stats.overallStats.totalTokensUsed || 0) + tokensUsed;
        const today = new Date().toISOString().slice(0, 10);
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = { totalTokensUsed: 0 };
        }
        stats.dailyStats[today].totalTokensUsed += tokensUsed;

        saveData(CHATS_PATH, chats);
        saveData(USERS_PATH, users);
        saveData(STATS_PATH, stats);

        res.write(JSON.stringify({ 
            type: 'end', 
            tokens: tokensUsed, 
            time: (durationMs / 1000).toFixed(2), 
            chatId: chatId,
            isNewChat: isNewChat
        }) + '\n');
        
        res.end();

    } catch (error) {
        if (error.name === 'AbortError') {
            if (!res.headersSent) {
                return res.status(499).json({ 
                    type: 'aborted', 
                    message: 'Generation abgebrochen' 
                });
            }
        } else {
            console.error('Chat error:', error);
            if (!res.headersSent) {
                res.status(500).json({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                });
            } else {
                res.write(JSON.stringify({ 
                    type: 'error', 
                    message: error.message || 'Interner Serverfehler',
                    code: error.code 
                }) + '\n');
                res.end();
            }
        }
    } finally {
        // Controller nach Beendigung entfernen (ob erfolgreich oder fehlgeschlagen)
        if (abortController) {
            userGenerationControllers.delete(req.userId);
        }
    }
});

// --- Admin-Endpunkte ---

// Admin: Alle Benutzer abrufen
app.get('/api/admin/users', authenticateUser, authorizeAdmin, (req, res) => {
    const safeUsers = users.users.map(({ password, ...rest }) => rest);
    res.json(safeUsers);
});

// Admin: Einzelnen Benutzer abrufen
app.get('/api/admin/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const user = users.users.find(u => u.id === userId);
    if (user) {
        const { password, ...safeUser } = user;
        res.json(safeUser);
    } else {
        res.status(404).json({ message: 'Benutzer nicht gefunden.' });
    }
});

// Admin: Benutzer erstellen
app.post('/api/admin/users', authenticateUser, authorizeAdmin, async (req, res) => {
    const { username, email, password, firstName, 'max-tokens': maxTokens, admin, profile } = req.body;

    if (!username || !email || !password || !firstName) {
        return res.status(400).json({ message: 'Alle erforderlichen Felder müssen ausgefüllt sein.' });
    }
    if (users.users.some(u => u.username === username || u.email === email)) {
        return res.status(409).json({ message: 'Benutzername oder E-Mail existiert bereits.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUserId = users.users.length > 0 ? Math.max(...users.users.map(u => u.id)) + 1 : 1;

    const newUser = {
        id: newUserId,
        username,
        email,
        password: hashedPassword,
        firstName,
        'max-tokens': maxTokens || '--',
        'used-tokens': 0,
        admin: !!admin,
        profile: {
            'personal-ai-prompt': profile['personal-ai-prompt'] || '',
            location: profile.location || ''
        }
    };
    users.users.push(newUser);
    saveData(USERS_PATH, users);

    await sendEmail(
        newUser.email,
        'Willkommen bei Tontoo AI!',
        `Hallo ${newUser.firstName},\n\nIhr Konto bei Tontoo AI wurde erfolgreich erstellt. Ihr Benutzername ist: ${newUser.username}\n\nSie können sich jetzt anmelden und den Chat nutzen.\n\nMit freundlichen Grüßen,\nIhr Tontoo AI Team`,
        `<p>Hallo ${newUser.firstName},</p><p>Ihr Konto bei Tontoo AI wurde erfolgreich erstellt. Ihr Benutzername ist: <strong>${newUser.username}</strong></p><p>Sie können sich jetzt anmelden und den Chat nutzen.</p><p>Mit freundlichen Grüßen,<br>Ihr Tontoo AI Team</p>`
    );

    res.status(201).json({ message: 'Benutzer erfolgreich erstellt.', user: { id: newUser.id, username: newUser.username } });
});

// Admin: Benutzer aktualisieren
app.put('/api/admin/users/:id', authenticateUser, authorizeAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    const { username, email, password, firstName, 'max-tokens': maxTokens, admin, profile } = req.body;
    const userIndex = users.users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'Benutzer nicht gefunden.' });
    }

    const userToUpdate = users.users[userIndex];

    if (username && users.users.some(u => u.username === username && u.id !== userId)) {
        return res.status(409).json({ message: 'Benutzername existiert bereits.' });
    }
    if (email && users.users.some(u => u.email === email && u.id !== userId)) {
        return res.status(409).json({ message: 'E-Mail existiert bereits.' });
    }

    userToUpdate.username = username || userToUpdate.username;
    userToUpdate.email = email || userToUpdate.email;
    if (password) {
        userToUpdate.password = await bcrypt.hash(password, 10);
    }
    userToUpdate.firstName = firstName || userToUpdate.firstName;
    userToUpdate['max-tokens'] = maxTokens !== undefined ? maxTokens : userToUpdate['max-tokens'];
    userToUpdate.admin = admin !== undefined ? !!admin : userToUpdate.admin;
    userToUpdate.profile['personal-ai-prompt'] = profile['personal-ai-prompt'] !== undefined ? profile['personal-ai-prompt'] : userToUpdate.profile['personal-ai-prompt'];
    userToUpdate.profile.location = profile.location !== undefined ? profile.location : userToUpdate.profile.location;

    saveData(USERS_PATH, users);
    res.json({ message: 'Benutzer erfolgreich aktualisiert.' });
});

// Admin: Benutzer löschen
app.delete('/api/admin/users/:id', authenticateUser, authorizeAdmin, (req, res) => {
    const userId = parseInt(req.params.id);
    const initialLength = users.users.length;
    users.users = users.users.filter(u => u.id !== userId);
    if (users.users.length < initialLength) {
        saveData(USERS_PATH, users);
        chats.chats = chats.chats.filter(c => c.user_id !== userId);
        saveData(CHATS_PATH, chats);
        res.json({ message: 'Benutzer und zugehörige Chats erfolgreich gelöscht.' });
    } else {
        res.status(404).json({ message: 'Benutzer nicht gefunden.' });
    }
});

// Admin: Alle Modelle abrufen
app.get('/api/admin/models', authenticateUser, authorizeAdmin, (req, res) => {
    res.json(models);
});

// Admin: Modell hinzufügen
app.post('/api/admin/models', authenticateUser, authorizeAdmin, async (req, res) => {
    const { ollamaModelId, displayName } = req.body;

    if (!ollamaModelId || !displayName) {
        return res.status(400).json({ message: 'Ollama Modell ID und Anzeigename sind erforderlich.' });
    }
    if (models[ollamaModelId]) {
        return res.status(409).json({ message: 'Modell existiert bereits.' });
    }

    try {
        const ollamaHost = config.ollama.host1;
        const ollamaPort = config.ollama.port;
        const ollamaModelInfo = await fetch(`http://${ollamaHost}:${ollamaPort}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: ollamaModelId })
        });

        if (!ollamaModelInfo.ok) {
            const errorText = await ollamaModelInfo.text();
            return res.status(400).json({ message: `Modell '${ollamaModelId}' nicht auf Ollama gefunden oder Fehler: ${errorText}` });
        }
    } catch (error) {
        console.error('Fehler bei Ollama-Modellprüfung:', error);
        return res.status(500).json({ message: `Fehler bei der Verbindung zum Ollama-Server oder Modellprüfung: ${error.message}` });
    }

    models[ollamaModelId] = displayName;
    saveData(MODELS_PATH, models);
    res.status(201).json({ message: 'Modell erfolgreich hinzugefügt.' });
});

// Admin: Modell löschen
app.delete('/api/admin/models/:id', authenticateUser, authorizeAdmin, (req, res) => {
    const modelId = req.params.id;
    if (models[modelId]) {
        delete models[modelId];
        saveData(MODELS_PATH, models);
        res.json({ message: 'Modell erfolgreich gelöscht.' });
    } else {
        res.status(404).json({ message: 'Modell nicht gefunden.' });
    }
});

// Admin: Statistiken abrufen
app.get('/api/admin/stats', authenticateUser, authorizeAdmin, (req, res) => {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const ramUsage = (totalMemory - freeMemory) / totalMemory;

    stats.overallStats.cpuUsageAvg = parseFloat(cpuUsage.toFixed(2));
    stats.overallStats.ramUsageAvg = parseFloat(ramUsage.toFixed(2));

    res.json(stats);
});

// Admin: Modell-Statistiken abrufen (Platzhalter)
app.get('/api/admin/model-stats/:modelId', authenticateUser, authorizeAdmin, (req, res) => {
    const modelId = req.params.id;
    const modelStat = stats.modelStats[modelId] || { totalTokens: 0, memoryUsageGB: 0 };
    res.json(modelStat);
});

// --- 404 Error Handling (einmalig) ---
app.use((req, res, next) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// --- Server starten (konsolidiert, mit Fehler-Handlern) ---
const httpServer = http.createServer((req, res) => {
    if (config['ssl-port'] && config['ssl-port'] !== 0) {
        res.writeHead(301, { "Location": `https://${req.headers.host.split(':')[0]}:${config['ssl-port']}${req.url}` });
        res.end();
    } else {
        app.handle(req, res);
    }
});

httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`Port ${config['main-port']} ist bereits belegt. HTTP-Server nicht gestartet.`);
    } else {
        console.error('HTTP-Server Fehler:', err);
    }
});

httpServer.listen(config['main-port'], () => {
    console.log(`HTTP-Server läuft auf Port ${config['main-port']}`);
});

if (config['ssl-port'] && fs.existsSync(path.join(SSL_DIR, 'cert.pem')) && fs.existsSync(path.join(SSL_DIR, 'key.pem'))) {
    const options = {
        key: fs.readFileSync(path.join(SSL_DIR, 'key.pem')),
        cert: fs.readFileSync(path.join(SSL_DIR, 'cert.pem'))
    };
    const httpsServer = https.createServer(options, app);

    httpsServer.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`Port ${config['ssl-port']} ist bereits belegt. HTTPS-Server nicht gestartet.`);
        } else {
            console.error('HTTPS-Server Fehler:', err);
        }
    });

    httpsServer.listen(config['ssl-port'], () => {
        console.log(`HTTPS-Server läuft auf Port ${config['ssl-port']}`);
    });
} else {
    console.log('SSL-Zertifikate nicht gefunden oder SSL-Port nicht konfiguriert. HTTPS-Server nicht gestartet.');
}

if (config['2er-port'] && config['2er-port'] !== 0 && config['2er-port'] !== config['main-port']) {
    const secondServer = http.createServer(app);

    secondServer.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`Port ${config['2er-port']} ist bereits belegt. Zweiter HTTP-Server nicht gestartet.`);
        } else {
            console.error('Zweiter HTTP-Server Fehler:', err);
        }
    });

    secondServer.listen(config['2er-port'], () => {
        console.log(`Zweiter HTTP-Server läuft auf Port ${config['2er-port']}`);
    });
}