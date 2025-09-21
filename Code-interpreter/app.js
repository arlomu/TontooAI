const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');

const app = express();
const PORT = 2463;
const TIMEOUT = 3 * 60 * 1000; // 3 Minuten in Millisekunden

// Middleware
app.use(express.json({ limit: '10mb' }));

// Hilfsfunktion für async exec
const execAsync = promisify(exec);

// Funktion zum Erstellen eines temporären Arbeitsverzeichnisses
async function createWorkingDirectory() {
    const workingDir = path.join(__dirname, 'code', uuidv4());
    await fs.mkdir(workingDir, { recursive: true });
    return workingDir;
}

// Funktion zum Löschen des Arbeitsverzeichnisses
async function cleanupWorkingDirectory(workingDir) {
    try {
        await fs.rm(workingDir, { recursive: true, force: true });
    } catch (error) {
        console.error('Fehler beim Löschen des Arbeitsverzeichnisses:', error);
    }
}

// Virtuelle Python-Umgebung anlegen
async function createPythonVenv(workingDir, pythonExecutable = "python3") {
    try {
        await execAsync(`${pythonExecutable} -m venv venv`, { cwd: workingDir });
        return path.join(workingDir, "venv");
    } catch (error) {
        throw new Error(`Fehler beim Erstellen des virtuellen Environments: ${error.message}`);
    }
}

// Python-Pakete in venv installieren
async function installPythonPackages(packages, workingDir) {
    if (!packages || packages.length === 0) return;

    const venvPath = path.join(workingDir, "venv");
    const pipPath = path.join(venvPath, "bin", "pip"); // Linux/Ubuntu Pfad

    const packagesString = packages.join(" ");
    const command = `${pipPath} install ${packagesString}`;

    try {
        await execAsync(command, { cwd: workingDir, timeout: TIMEOUT });
    } catch (error) {
        throw new Error(`Fehler beim Installieren der Python-Pakete: ${error.message}`);
    }
}

// Node.js-Pakete installieren
async function installNodePackages(packages, workingDir) {
    if (!packages || packages.length === 0) return;

    // package.json erstellen
    const packageJson = {
        name: "temp-execution",
        version: "1.0.0",
        dependencies: {}
    };

    packages.forEach(pkg => {
        packageJson.dependencies[pkg] = "latest";
    });

    await fs.writeFile(
        path.join(workingDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
    );

    try {
        await execAsync('npm install', {
            cwd: workingDir,
            timeout: TIMEOUT
        });
    } catch (error) {
        throw new Error(`Fehler beim Installieren der Node.js-Pakete: ${error.message}`);
    }
}

// Python-Code ausführen (im venv)
async function executePythonCode(code, version, workingDir, hasInternet) {
    const venvPath = path.join(workingDir, "venv");
    const pythonExecutable = path.join(venvPath, "bin", "python");

    const filename = path.join(workingDir, 'main.py');
    await fs.writeFile(filename, code);

    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        if (!hasInternet) {
            env.no_proxy = '*';
            env.NO_PROXY = '*';
        }

        const child = spawn(pythonExecutable, [filename], {
            cwd: workingDir,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Code-Ausführung hat das Zeitlimit überschritten (3 Minuten)'));
        }, TIMEOUT);

        child.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                resolve(stdout || 'Code erfolgreich ausgeführt (keine Ausgabe)');
            } else {
                reject(new Error(stderr || `Python-Prozess beendet mit Code ${code}`));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`Fehler beim Ausführen des Python-Codes: ${error.message}`));
        });
    });
}

// Node.js-Code ausführen
async function executeNodeCode(code, version, workingDir, hasInternet) {
    const nodeExecutable = 'node';
    const filename = path.join(workingDir, 'main.js');

    await fs.writeFile(filename, code);

    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        if (!hasInternet) {
            env.no_proxy = '*';
            env.NO_PROXY = '*';
        }

        const child = spawn(nodeExecutable, [filename], {
            cwd: workingDir,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Code-Ausführung hat das Zeitlimit überschritten (3 Minuten)'));
        }, TIMEOUT);

        child.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
                resolve(stdout || 'Code erfolgreich ausgeführt (keine Ausgabe)');
            } else {
                reject(new Error(stderr || `Node.js-Prozess beendet mit Code ${code}`));
            }
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`Fehler beim Ausführen des Node.js-Codes: ${error.message}`));
        });
    });
}

// Hauptendpoint für Code-Ausführung
app.post('/execute', async (req, res) => {
    const { code, internet = "false", packages = [], language, version } = req.body;

    // Validierung der Eingabe
    if (!code) {
        return res.json({
            status: "error",
            message: "Kein Code bereitgestellt"
        });
    }

    if (!language || !['python', 'nodejs', 'node'].includes(language.toLowerCase())) {
        return res.json({
            status: "error",
            message: "Unsupported language. Unterstützte Sprachen: python, nodejs"
        });
    }

    let workingDir;

    try {
        // Arbeitsverzeichnis erstellen
        workingDir = await createWorkingDirectory();

        const hasInternet = internet === "true" || internet === true;
        const normalizedLanguage = language.toLowerCase();

        // Pakete installieren
        if (normalizedLanguage === 'python') {
            await createPythonVenv(workingDir);
            await installPythonPackages(packages, workingDir);
        } else if (normalizedLanguage === 'nodejs' || normalizedLanguage === 'node') {
            await installNodePackages(packages, workingDir);
        }

        // Code ausführen
        let output;
        if (normalizedLanguage === 'python') {
            output = await executePythonCode(code, version, workingDir, hasInternet);
        } else {
            output = await executeNodeCode(code, version, workingDir, hasInternet);
        }

        res.json({
            status: "success",
            output: output
        });

    } catch (error) {
        res.json({
            status: "error",
            message: error.message
        });
    } finally {
        // Arbeitsverzeichnis aufräumen
        if (workingDir) {
            await cleanupWorkingDirectory(workingDir);
        }
    }
});

// Health-Check-Endpoint
app.get('/health', (req, res) => {
    res.json({
        status: "success",
        message: "Code Interpreter Service läuft",
        port: PORT
    });
});

// Python-Installation beim Start überprüfen/installieren
async function ensurePythonInstallation() {
    try {
        await execAsync('python3 --version');
        console.log('Python3 ist bereits installiert');

        await execAsync('pip3 --version');
        console.log('pip3 ist bereits installiert');
    } catch (error) {
        console.log('Python3 oder pip3 nicht gefunden. Installation wird versucht...');
        try {
            await execAsync('sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv');
            console.log('Python3, pip3 und venv erfolgreich installiert');
        } catch (installError) {
            console.error('Automatische Python-Installation fehlgeschlagen:', installError.message);
            console.log('Bitte installiere Python3, pip3 und python3-venv manuell');
        }
    }
}

// Server starten
async function startServer() {
    console.log('Überprüfe Python-Installation...');
    await ensurePythonInstallation();

    await fs.mkdir(path.join(__dirname, 'code'), { recursive: true });

    app.listen(PORT, () => {
        console.log(`Code Interpreter Service läuft auf Port ${PORT}`);
        console.log(`Health-Check: http://localhost:${PORT}/health`);
        console.log(`Code-Ausführung: POST http://localhost:${PORT}/execute`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nServer wird heruntergefahren...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nServer wird heruntergefahren...');
    process.exit(0);
});

// Server starten
startServer().catch(console.error);

module.exports = app;
