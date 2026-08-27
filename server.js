import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { spawn as childSpawn, exec as childExec, execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { setupTaskManager } from './taskManager.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import node-pty dynamically or handle fallback
let ptyModule = null;
try {
  ptyModule = require('node-pty');
  console.log('✅ node-pty loaded successfully.');
} catch (err) {
  console.warn('⚠️ node-pty could not be loaded, using child_process fallback:', err.message);
}

const app = express();
const httpServer = createServer(app);

// Initialize Socket.io with CORS configuration
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Setup Real-time Task Manager Engine
setupTaskManager(io);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==========================================
// VDS noVNC & WEBSOCKIFY PROXY (HTML5 Streaming)
// ==========================================
const vncTarget = process.env.VNC_TARGET || 'http://127.0.0.1:6080';

// Proxy static assets & HTML5 interface of noVNC
app.use('/novnc', createProxyMiddleware({
  target: vncTarget,
  changeOrigin: true,
  pathRewrite: { '^/novnc': '' },
  ws: true,
  onError: (err, req, res) => {
    if (res.headersSent) return;
    res.status(502).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; }
          .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(51, 65, 85, 0.8); border-radius: 1rem; padding: 2.5rem; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
          h2 { color: #f43f5e; margin-top: 0; font-size: 1.25rem; }
          p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
          button { margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #0284c7; color: white; border: none; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
          button:hover { background: #0369a1; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🖥️ VDS Ekran Sunucusu Bekleniyor...</h2>
          <p>Xvfb, XFCE masaüstü ve noVNC (websockify) grafik motoruna şu anda bağlanılamadı. Docker konteyneriniz başlatıldığında ekran otomatik aktifleşecektir.</p>
          <button onclick="location.reload()">Sayfayı Yenile</button>
        </div>
      </body>
      </html>
    `);
  }
}));

// Proxy WebSocket stream for VNC
const wsProxy = createProxyMiddleware({
  target: vncTarget,
  ws: true,
  changeOrigin: true
});
app.use('/websockify', wsProxy);
app.use('/vnc', wsProxy);

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url && (req.url.startsWith('/websockify') || req.url.startsWith('/novnc') || req.url.startsWith('/vnc'))) {
    wsProxy.upgrade(req, socket, head);
  }
});

// Serve static frontend files from 'public' directory
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Serve local noVNC library package statically for zero-CDN local/offline & preview compatibility
const novncLibPath = path.join(__dirname, 'node_modules/@novnc/novnc');
if (fs.existsSync(novncLibPath)) {
  app.use('/vendor/novnc', express.static(novncLibPath));
}

// Auto-start VNC background display processes if binaries exist
function ensureVncServices() {
  try {
    try {
      execSync('rm -f /tmp/.X99-lock /tmp/.X11-unix/X99', { stdio: 'ignore' });
    } catch (e) {}

    const display = process.env.DISPLAY || ':99';

    // Start Xvfb if available and not running
    try {
      execSync('which Xvfb', { stdio: 'ignore' });
      childExec(`pgrep Xvfb || Xvfb ${display} -screen 0 1280x720x24 -ac +extension GLX +render -noreset &`, (err) => {
        if (err) console.warn('Xvfb spawn notice:', err.message);
      });
    } catch (e) {}

    // Start x11vnc if available and not running
    try {
      execSync('which x11vnc', { stdio: 'ignore' });
      childExec(`pgrep x11vnc || x11vnc -display ${display} -forever -shared -rfbport 5900 -nopw &`, (err) => {
        if (err) console.warn('x11vnc spawn notice:', err.message);
      });
    } catch (e) {}

    // Start websockify if available and not running
    try {
      execSync('which websockify', { stdio: 'ignore' });
      childExec('pgrep websockify || websockify 6080 127.0.0.1:5900 &', (err) => {
        if (err) console.warn('websockify spawn notice:', err.message);
      });
    } catch (e) {}
  } catch (err) {
    console.warn('VNC service auto-start check:', err.message);
  }
}

ensureVncServices();

// API to check VNC server availability
app.get('/api/vnc-status', (req, res) => {
  import('net').then(({ default: net }) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.connect(6080, '127.0.0.1', () => {
      socket.end();
      res.json({ active: true, display: process.env.DISPLAY || ':99' });
    });
    socket.on('error', () => {
      res.json({ active: false, reason: 'VNC display server is offline' });
    });
    socket.on('timeout', () => {
      socket.destroy();
      res.json({ active: false, reason: 'VNC connection timeout' });
    });
  }).catch(() => {
    res.json({ active: false, reason: 'Network error' });
  });
});

// Workspace root directory for file manager navigation
const WORKSPACE_ROOT = process.cwd();

// Helper for safe path resolution (prevent path traversal vulnerabilities)
function getSafePath(targetPath) {
  if (!targetPath) return WORKSPACE_ROOT;
  const resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  // Ensure the resolved path starts with the allowed workspace root or system root safely
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    return WORKSPACE_ROOT;
  }
  return resolved;
}

// ==========================================
// 1. TERMINAL SOCKET.IO (node-pty) INTEGRATION
// ==========================================
io.on('connection', (socket) => {
  console.log(`🔌 New terminal client connected: ${socket.id}`);

  const isWindows = os.platform() === 'win32';
  let shell = isWindows ? 'powershell.exe' : '/bin/bash';

  // Check if bash exists on Linux, fallback to sh if needed
  if (!isWindows && !fs.existsSync('/bin/bash')) {
    shell = '/bin/sh';
  }

  const initialCwd = process.env.HOME || WORKSPACE_ROOT;
  let ptyProcess = null;
  let isNativePty = false;

  if (ptyModule) {
    try {
      ptyProcess = ptyModule.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: initialCwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
      isNativePty = true;
      console.log(`🚀 Launched native PTY process [PID: ${ptyProcess.pid}] using ${shell}`);
    } catch (ptyError) {
      console.error('Failed to spawn node-pty process, falling back to child_process:', ptyError);
    }
  }

  // Fallback using child_process.spawn if node-pty is unavailable
  if (!ptyProcess) {
    console.log(`⚠️ Spawning fallback terminal process using ${shell}`);
    try {
      ptyProcess = childSpawn(shell, [], {
        cwd: initialCwd,
        env: { ...process.env, TERM: 'xterm-256color' }
      });
    } catch (spawnErr) {
      console.error('Failed to spawn fallback shell:', spawnErr);
      socket.emit('terminal-output', `\r\nError launching shell: ${spawnErr.message}\r\n`);
      return;
    }
  }

  // Forward PTY output data to socket client
  if (isNativePty) {
    ptyProcess.onData((data) => {
      socket.emit('terminal-output', data);
    });
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`PTY Process exited with code ${exitCode}, signal ${signal}`);
      socket.emit('terminal-output', `\r\n[Process exited with code ${exitCode}]\r\n`);
    });
  } else {
    // Child process fallback handlers
    ptyProcess.stdout?.on('data', (data) => {
      socket.emit('terminal-output', data.toString());
    });
    ptyProcess.stderr?.on('data', (data) => {
      socket.emit('terminal-output', data.toString());
    });
    ptyProcess.on('close', (code) => {
      socket.emit('terminal-output', `\r\n[Process exited with code ${code}]\r\n`);
    });
  }

  // Handle terminal input from client (keystrokes, commands)
  socket.on('terminal-input', (data) => {
    try {
      if (isNativePty && ptyProcess) {
        ptyProcess.write(data);
      } else if (ptyProcess && ptyProcess.stdin) {
        ptyProcess.stdin.write(data);
      }
    } catch (err) {
      console.error('Error writing to terminal input:', err);
    }
  });

  // Handle terminal window resize event
  socket.on('terminal-resize', (dimensions) => {
    if (isNativePty && ptyProcess && dimensions && dimensions.cols && dimensions.rows) {
      try {
        ptyProcess.resize(dimensions.cols, dimensions.rows);
      } catch (err) {
        console.error('Error resizing PTY:', err);
      }
    }
  });

  // Clean up PTY process on client disconnect to prevent memory leaks
  socket.on('disconnect', () => {
    console.log(`❌ Terminal client disconnected: ${socket.id}`);
    if (ptyProcess) {
      try {
        if (isNativePty) {
          ptyProcess.kill();
        } else {
          ptyProcess.kill('SIGTERM');
        }
        console.log('🧹 Cleaned up PTY process on disconnect.');
      } catch (killErr) {
        console.error('Error killing PTY process:', killErr);
      }
    }
  });
});

// ==========================================
// 2. FILE SYSTEM REST API FOR DOSYA YÖNETİCİSİ
// ==========================================

// List directory items (files & folders)
app.get('/api/fs/list', async (req, res) => {
  try {
    const targetDir = getSafePath(req.query.dir || '');
    const items = await fs.promises.readdir(targetDir, { withFileTypes: true });

    const result = await Promise.all(
      items.map(async (item) => {
        const itemPath = path.join(targetDir, item.name);
        const relativePath = path.relative(WORKSPACE_ROOT, itemPath);
        let size = 0;
        let mtime = null;

        try {
          const stats = await fs.promises.stat(itemPath);
          size = stats.size;
          mtime = stats.mtime;
        } catch {
          // Ignore permission errors for stat
        }

        return {
          name: item.name,
          path: itemPath,
          relativePath: relativePath || '/',
          isDirectory: item.isDirectory(),
          size: size,
          mtime: mtime,
          extension: item.isDirectory() ? '' : path.extname(item.name).toLowerCase()
        };
      })
    );

    // Sort directories first, then files alphabetically
    result.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      success: true,
      currentDir: targetDir,
      relativePath: path.relative(WORKSPACE_ROOT, targetDir) || '/',
      parentDir: targetDir === WORKSPACE_ROOT ? null : path.dirname(targetDir),
      items: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read file content
app.get('/api/fs/read', async (req, res) => {
  try {
    const filePath = getSafePath(req.query.file);
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      return res.status(400).json({ success: false, error: 'Path is a directory, not a file' });
    }

    if (stats.size > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'File size too large to edit (>10MB)' });
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    res.json({
      success: true,
      file: filePath,
      name: path.basename(filePath),
      size: stats.size,
      mtime: stats.mtime,
      content: content
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Write / Save file content
app.post('/api/fs/write', async (req, res) => {
  try {
    const { file, content } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, error: 'File path is required' });
    }

    const filePath = getSafePath(file);
    const parentDir = path.dirname(filePath);

    await fs.promises.mkdir(parentDir, { recursive: true });
    await fs.promises.writeFile(filePath, content ?? '', 'utf-8');

    res.json({ success: true, message: 'File saved successfully', path: filePath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new file
app.post('/api/fs/create-file', async (req, res) => {
  try {
    const { file, content } = req.body;
    if (!file) {
      return res.status(400).json({ success: false, error: 'File path is required' });
    }

    const filePath = getSafePath(file);
    if (fs.existsSync(filePath)) {
      return res.status(400).json({ success: false, error: 'File already exists' });
    }

    await fs.promises.writeFile(filePath, content || '', 'utf-8');
    res.json({ success: true, message: 'File created successfully', path: filePath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new directory / folder
app.post('/api/fs/create-folder', async (req, res) => {
  try {
    const { folder } = req.body;
    if (!folder) {
      return res.status(400).json({ success: false, error: 'Folder path is required' });
    }

    const folderPath = getSafePath(folder);
    await fs.promises.mkdir(folderPath, { recursive: true });

    res.json({ success: true, message: 'Folder created successfully', path: folderPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete file or directory
app.delete('/api/fs/delete', async (req, res) => {
  try {
    const target = req.query.target || req.body?.target;
    if (!target) {
      return res.status(400).json({ success: false, error: 'Target path is required' });
    }

    const targetPath = getSafePath(target);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, error: 'File or folder does not exist' });
    }

    await fs.promises.rm(targetPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Target deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rename file or directory
app.post('/api/fs/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'oldPath and newPath are required' });
    }

    const source = getSafePath(oldPath);
    const dest = getSafePath(newPath);

    await fs.promises.rename(source, dest);
    res.json({ success: true, message: 'Renamed successfully', path: dest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Configure Multer Storage for file uploads
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = getSafePath(req.query.dir || req.body?.dir || '');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Upload files to active folder
app.post('/api/fs/upload', upload.array('files'), (req, res) => {
  try {
    const targetDir = getSafePath(req.query.dir || req.body?.dir || '');
    const uploadedFiles = req.files || [];
    res.json({
      success: true,
      message: `${uploadedFiles.length} dosya başarıyla yüklendi.`,
      targetDir,
      files: uploadedFiles.map(f => f.originalname)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download file endpoint
app.get('/api/fs/download', (req, res) => {
  try {
    const filePath = getSafePath(req.query.file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Dosya bulunamadı' });
    }

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return res.status(400).json({ success: false, error: 'Klasörler doğrudan indirilemez' });
    }

    const filename = path.basename(filePath);
    res.download(filePath, filename);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. VDS EXECUTION APIs (Google Chrome & Wine .exe)
// ==========================================

// Launch Google Chrome inside VDS Display (:99)
app.post('/api/vds/launch-chrome', (req, res) => {
  try {
    const url = req.body?.url || 'https://www.google.com';
    const display = process.env.DISPLAY || ':99';

    // Command to launch Google Chrome on display :99
    const chromeCmd = `DISPLAY=${display} google-chrome-stable --no-sandbox --disable-dev-shm-usage --no-first-run --start-maximized "${url}" &`;

    childExec(chromeCmd, (err) => {
      if (err) console.warn('⚠️ Chrome launch warning:', err.message);
    });

    res.json({
      success: true,
      message: 'Google Chrome VDS ekranında (:99) başlatıldı.',
      url,
      display
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// WEB BROWSER PROXY & GOOGLE SEARCH ENGINE
// ==========================================
const renderGoogleSearchUI = (query = '', results = [], errorMsg = null) => {
  const safeQuery = (query || '').replace(/"/g, '&quot;');
  
  const resultsHtml = results.length > 0
    ? results.map(r => {
        const displayUrl = r.url ? (r.url.replace(/^https?:\/\//, '').split('/')[0] + (r.url.split('/')[1] ? ' › ' + r.url.split('/').slice(3, 5).join(' › ') : '')) : '';
        return `
          <div class="result-item">
            <div class="result-cite">
              <span class="result-favicon-box">🌐</span>
              <span class="result-url-text">${displayUrl}</span>
            </div>
            <a href="/api/proxy?url=${encodeURIComponent(r.url)}" class="result-title">${r.title}</a>
            <div class="result-snippet">${r.snippet}</div>
          </div>
        `;
      }).join('')
    : (query
        ? `<div class="no-results">
            <h3>"${safeQuery}" için sonuç bulunamadı.</h3>
            <p>Yazımı kontrol edin veya farklı anahtar kelimeler deneyin.</p>
           </div>`
        : '');

  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${query ? safeQuery + ' - Google Arama' : 'Google'}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: #202124; color: #e8eaed; min-height: 100vh; display: flex; flex-direction: column; }
        a { color: #8ab4f8; text-decoration: none; }
        a:hover { text-decoration: underline; }
        
        /* Top Navigation Header */
        .g-header { display: flex; justify-content: flex-end; align-items: center; padding: 1rem 1.5rem; gap: 1rem; font-size: 13px; }
        .g-header a { color: #e8eaed; text-decoration: none; }
        .g-header a:hover { text-decoration: underline; }
        
        /* Home Mode */
        .home-container { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem 1rem 4rem; text-align: center; }
        .g-logo { font-size: 4rem; font-weight: 700; letter-spacing: -1px; margin-bottom: 1.5rem; user-select: none; }
        .g-blue { color: #4285f4; }
        .g-red { color: #ea4335; }
        .g-yellow { color: #fbbc05; }
        .g-green { color: #34a853; }
        
        /* Search Box */
        .search-box-wrap { width: 100%; max-width: 580px; position: relative; margin-bottom: 1.5rem; }
        .search-form { display: flex; align-items: center; background: #303134; border: 1px solid #5f6368; border-radius: 24px; padding: 0.6rem 1rem; box-shadow: 0 1px 6px rgba(0,0,0,0.28); transition: all 0.2s ease; }
        .search-form:hover, .search-form:focus-within { background: #303134; border-color: #8ab4f8; box-shadow: 0 2px 8px rgba(0,0,0,0.45); }
        .search-icon { color: #9aa0a6; margin-right: 0.75rem; font-size: 1.1rem; }
        .search-input { flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 16px; }
        .search-btn-submit { background: transparent; border: none; color: #8ab4f8; cursor: pointer; font-size: 14px; font-weight: 500; padding: 0.3rem 0.6rem; border-radius: 4px; }
        .search-btn-submit:hover { background: rgba(138,180,248,0.1); }
        
        /* Home Shortcuts */
        .shortcuts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; width: 100%; max-width: 480px; margin-top: 1.5rem; }
        .sc-card { display: flex; flex-direction: column; align-items: center; padding: 0.75rem 0.5rem; border-radius: 12px; background: #303134/40; border: 1px solid #3c4043; transition: all 0.2s ease; }
        .sc-card:hover { background: #3c4043; transform: translateY(-2px); text-decoration: none; }
        .sc-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; margin-bottom: 0.5rem; background: #202124; }
        .sc-name { font-size: 12px; color: #bdc1c6; }
        
        /* Results Mode */
        .results-header { display: flex; align-items: center; padding: 1.25rem 2rem; border-bottom: 1px solid #3c4043; gap: 2rem; background: #202124; position: sticky; top: 0; z-index: 10; }
        .res-logo { font-size: 1.6rem; font-weight: 700; text-decoration: none; }
        .res-search-box { flex: 1; max-width: 640px; }
        .results-body { flex: 1; max-width: 720px; padding: 1.5rem 2rem 3rem 2rem; }
        .result-stats { font-size: 13px; color: #9aa0a6; margin-bottom: 1.5rem; }
        .result-item { margin-bottom: 1.75rem; }
        .result-cite { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
        .result-favicon-box { font-size: 13px; }
        .result-url-text { font-size: 12px; color: #bdc1c6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .result-title { font-size: 20px; color: #8ab4f8; line-height: 1.3; display: inline-block; margin-bottom: 0.35rem; }
        .result-snippet { font-size: 14px; color: #bdc1c6; line-height: 1.58; word-wrap: break-word; }
        .no-results { padding: 3rem 1rem; text-align: center; color: #9aa0a6; }
        .no-results h3 { color: #e8eaed; margin-bottom: 0.5rem; }
      </style>
    </head>
    <body>
      ${!query ? `
        <!-- GOOGLE HOME -->
        <div class="g-header">
          <a href="/api/proxy?url=https%3A%2F%2Fwww.google.com">Google</a>
          <a href="/api/proxy?url=https%3A%2F%2Fgithub.com">GitHub</a>
          <a href="/api/proxy?url=https%3A%2F%2Fwikipedia.org">Wikipedia</a>
        </div>
        <div class="home-container">
          <div class="g-logo">
            <span class="g-blue">G</span><span class="g-red">o</span><span class="g-yellow">o</span><span class="g-blue">g</span><span class="g-green">l</span><span class="g-red">e</span>
          </div>
          <div class="search-box-wrap">
            <form class="search-form" method="GET" action="/api/proxy">
              <span class="search-icon">🔍</span>
              <input type="text" name="q" class="search-input" placeholder="Google'da arayın veya URL yazın..." autofocus autocomplete="off" />
              <button type="submit" class="search-btn-submit">Ara</button>
            </form>
          </div>
          <div class="shortcuts-grid">
            <a href="/api/proxy?url=https%3A%2F%2Fwww.youtube.com" class="sc-card">
              <div class="sc-icon">▶️</div>
              <span class="sc-name">YouTube</span>
            </a>
            <a href="/api/proxy?url=https%3A%2F%2Fwikipedia.org" class="sc-card">
              <div class="sc-icon">📚</div>
              <span class="sc-name">Wikipedia</span>
            </a>
            <a href="/api/proxy?url=https%3A%2F%2Fgithub.com" class="sc-card">
              <div class="sc-icon">🐙</div>
              <span class="sc-name">GitHub</span>
            </a>
            <a href="/api/proxy?url=https%3A%2F%2Fnews.ycombinator.com" class="sc-card">
              <div class="sc-icon">📰</div>
              <span class="sc-name">Hacker News</span>
            </a>
          </div>
        </div>
      ` : `
        <!-- GOOGLE SEARCH RESULTS -->
        <div class="results-header">
          <a href="/api/proxy?url=https%3A%2F%2Fwww.google.com" class="res-logo">
            <span class="g-blue">G</span><span class="g-red">o</span><span class="g-yellow">o</span><span class="g-blue">g</span><span class="g-green">l</span><span class="g-red">e</span>
          </a>
          <div class="res-search-box">
            <form class="search-form" method="GET" action="/api/proxy">
              <span class="search-icon">🔍</span>
              <input type="text" name="q" class="search-input" value="${safeQuery}" autocomplete="off" />
              <button type="submit" class="search-btn-submit">Ara</button>
            </form>
          </div>
        </div>
        <div class="results-body">
          <div class="result-stats">Yaklaşık ${results.length} sonuç bulundu</div>
          ${resultsHtml}
        </div>
      `}
      <script>
        // Update URL bar in parent WebOS Chrome window
        try {
          window.parent.postMessage({
            type: 'browser-url',
            url: ${JSON.stringify(query ? `https://www.google.com/search?q=${encodeURIComponent(query)}` : 'https://www.google.com')}
          }, '*');
        } catch(e) {}
      </script>
    </body>
    </html>
  `;
};

const handleBrowserProxy = async (req, res) => {
  try {
    let rawQuery = req.query.q || req.query.url || req.query.search;

    if (!rawQuery || rawQuery.trim() === '') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderGoogleSearchUI(''));
    }

    rawQuery = rawQuery.trim();

    // Check if user is asking for Google homepage
    if (
      rawQuery === 'https://www.google.com' ||
      rawQuery === 'https://www.google.com/' ||
      rawQuery === 'http://www.google.com' ||
      rawQuery === 'https://google.com' ||
      rawQuery === 'google.com' ||
      rawQuery === 'www.google.com'
    ) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderGoogleSearchUI(''));
    }

    // Check if query is a Google Search URL e.g. https://www.google.com/search?q=...
    if (rawQuery.includes('google.com/search')) {
      try {
        const u = new URL(rawQuery.startsWith('http') ? rawQuery : 'https://' + rawQuery);
        const extractedQ = u.searchParams.get('q');
        if (extractedQ) rawQuery = extractedQ;
      } catch (e) {}
    }

    // Check if input is a direct URL or search term
    const isDirectUrl = (rawQuery.startsWith('http://') || rawQuery.startsWith('https://')) ||
      (rawQuery.includes('.') && !rawQuery.includes(' ') && !rawQuery.includes('?q='));

    if (!isDirectUrl) {
      // Execute live search query via DuckDuckGo HTML parser
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(rawQuery)}`;
      const searchResp = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      const searchHtml = await searchResp.text();
      const results = [];

      // Extract results from DDG HTML
      const resultBlocks = searchHtml.split(/<div[^>]*class=\"(?:result|results_links)[^>]*>/gi);
      for (const block of resultBlocks) {
        if (results.length >= 15) break;

        // Title and URL extraction
        const titleMatch = /<a[^>]*class=\"result__snippet\"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
                           /<a[^>]*class=\"result__url\"[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const linkMatch = /<a[^>]*class=\"result__url\"[^>]*href=\"([^\"]+)\"/i.exec(block) ||
                          /<a[^>]*class=\"result__title\"[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/i.exec(block);

        let linkHref = linkMatch ? linkMatch[1] : null;
        let title = linkMatch && linkMatch[2] ? linkMatch[2].replace(/<[^>]+>/g, '').trim() : '';

        if (!title && titleMatch) {
          title = (titleMatch[2] || titleMatch[1] || '').replace(/<[^>]+>/g, '').trim();
        }

        const snippetMatch = /<a[^>]*class=\"result__snippet\"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        if (linkHref) {
          // Decode DuckDuckGo redirect link: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
          let realUrl = linkHref;
          if (linkHref.includes('uddg=')) {
            const matchUddg = /uddg=([^&]+)/.exec(linkHref);
            if (matchUddg && matchUddg[1]) {
              try { realUrl = decodeURIComponent(matchUddg[1]); } catch (e) {}
            }
          }
          if (realUrl.startsWith('//')) realUrl = 'https:' + realUrl;

          if (realUrl.startsWith('http') && !realUrl.includes('duckduckgo.com/y.js')) {
            results.push({
              title: title || realUrl,
              url: realUrl,
              snippet: snippet || 'Web sayfası içeriği için tıklayın.'
            });
          }
        }
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderGoogleSearchUI(rawQuery, results));
    }

    // Direct Website Proxy Mode
    let targetUrl = rawQuery;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || 'text/html';

    // Strip frame restrictions on response
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;");
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Remove security meta tags and frame busters
      html = html.replace(/<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
      html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
      html = html.replace(/if\s*\(\s*(?:top|window\.top)\s*!==?\s*(?:self|window\.self)\s*\)/gi, 'if (false)');
      html = html.replace(/(?:top|window\.top)\.location\s*=/gi, 'window.location=');

      const parsedUrl = new URL(targetUrl);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;
      const baseTag = `<base href="${baseUrl}">`;

      // Injected script to intercept navigation & keep clicks inside the proxy
      const interceptScript = `
        <script>
          (function() {
            try {
              // Update URL in parent WebOS Chrome bar
              window.parent.postMessage({ type: 'browser-url', url: ${JSON.stringify(targetUrl)} }, '*');
            } catch(e) {}

            document.addEventListener('click', function(e) {
              const a = e.target.closest('a');
              if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
                e.preventDefault();
                window.location.href = '/api/proxy?url=' + encodeURIComponent(a.href);
              }
            }, true);

            document.addEventListener('submit', function(e) {
              const form = e.target.closest('form');
              if (form) {
                e.preventDefault();
                const action = form.action || window.location.href;
                const formData = new FormData(form);
                const params = new URLSearchParams(formData);
                const method = (form.method || 'GET').toUpperCase();
                if (method === 'GET') {
                  const sep = action.includes('?') ? '&' : '?';
                  window.location.href = '/api/proxy?url=' + encodeURIComponent(action + sep + params.toString());
                }
              }
            }, true);
          })();
        </script>
      `;

      if (html.toLowerCase().includes('<head>')) {
        html = html.replace(/<head>/i, `<head>${baseTag}${interceptScript}`);
      } else {
        html = `${baseTag}${interceptScript}${html}`;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } else {
      res.setHeader('Content-Type', contentType);
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.send(buffer);
    }
  } catch (err) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { background: #202124; color: #f8fafc; font-family: Roboto, sans-serif; padding: 2rem; margin: 0; }
          .err-box { max-width: 500px; margin: 2rem auto; background: #303134; padding: 2rem; border-radius: 1rem; border: 1px solid #5f6368; }
          h2 { color: #f28b82; margin-top: 0; font-size: 1.25rem; }
          p { color: #bdc1c6; font-size: 0.875rem; }
          code { background: #202124; padding: 0.5rem 0.75rem; border-radius: 0.5rem; color: #8ab4f8; display: block; margin: 1rem 0; word-break: break-all; font-family: monospace; font-size: 0.8rem; }
          .btn-home { display: inline-block; background: #8ab4f8; color: #202124; padding: 0.5rem 1rem; border-radius: 4px; font-weight: 500; text-decoration: none; margin-top: 1rem; }
        </style>
      </head>
      <body>
        <div class="err-box">
          <h2>⚠️ Web Sayfası Yüklenemedi</h2>
          <p>İstenen siteye bağlanırken bir sorun oluştu:</p>
          <code>${req.query.q || req.query.url || ''}</code>
          <p>Hata Detayı: ${err.message}</p>
          <a href="/api/proxy?url=https%3A%2F%2Fwww.google.com" class="btn-home">Google Ana Sayfasına Dön</a>
        </div>
      </body>
      </html>
    `);
  }
};

app.get('/api/browser/proxy', handleBrowserProxy);
app.get('/api/proxy', handleBrowserProxy);

// Launch Windows .exe application using Wine inside VDS Display (:99)
const runWineExeHandler = (req, res) => {
  try {
    const exePath = req.body?.filePath || req.body?.file || req.body?.exePath;
    if (!exePath) {
      return res.status(400).json({ success: false, error: 'Çalıştırılacak .exe dosya yolu gerekli.' });
    }

    const safePath = getSafePath(exePath);
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ success: false, error: 'Dosya bulunamadı: ' + exePath });
    }

    const display = process.env.DISPLAY || ':99';
    const wineCmd = `DISPLAY=${display} wine "${safePath}" &`;

    console.log(`🍷 Executing Windows application via Wine: ${safePath}`);
    childExec(wineCmd, (err) => {
      if (err) console.warn('⚠️ Wine launch notice:', err.message);
    });

    res.json({
      success: true,
      message: `"${path.basename(safePath)}" Wine ile VDS ekranında başlatıldı.`,
      filePath: safePath,
      display
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/run-exe', runWineExeHandler);
app.post('/api/vds/launch-wine', runWineExeHandler);

// ==========================================
// REAL GOOGLE CHROME VDS LAUNCHER
// ==========================================
// Function to detect available browser executable in PATH
function getBrowserBinary() {
  const candidates = [
    'google-chrome-stable',
    'google-chrome',
    'chromium-browser',
    'chromium',
    'firefox'
  ];
  for (const cmd of candidates) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return cmd;
    } catch (e) {
      // not found
    }
  }
  return null;
}

const startChromeHandler = (req, res) => {
  try {
    const targetUrl = req.body?.url || req.query?.url || 'https://www.google.com';
    const display = process.env.DISPLAY || ':99';

    // Only launch background GUI browser if virtual X display server (:99 / Xvfb) is active
    let isVirtualDisplayRunning = false;
    try {
      if (os.platform() === 'linux') {
        execSync('pgrep Xvfb', { stdio: 'ignore' });
        isVirtualDisplayRunning = true;
      }
    } catch (e) {
      isVirtualDisplayRunning = false;
    }

    if (!isVirtualDisplayRunning) {
      // Running locally or in preview without virtual X server -> Embedded WebOS browser mode
      return res.json({
        success: true,
        mode: 'embedded',
        url: targetUrl,
        message: 'WebOS dahili bulut tarayıcı modu aktif.'
      });
    }

    const browserCmd = getBrowserBinary();
    if (!browserCmd) {
      return res.json({
        success: true,
        mode: 'embedded',
        warning: 'Google Chrome / Chromium sanal sistemde bulunamadı. Dahili mod aktif.',
        url: targetUrl
      });
    }

    console.log(`🌐 Launching ${browserCmd} on virtual display (${display}): ${targetUrl}`);

    const chromeEnv = { ...process.env, DISPLAY: display };
    const chromeProc = childSpawn(browserCmd, [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
      '--start-maximized',
      targetUrl
    ], {
      env: chromeEnv,
      detached: true,
      stdio: 'ignore'
    });

    // Handle spawn errors gracefully so Node process does not crash
    chromeProc.on('error', (procErr) => {
      console.warn(`⚠️ Chrome process spawn error (${browserCmd}):`, procErr.message);
    });

    chromeProc.unref();

    res.json({
      success: true,
      mode: 'vnc',
      message: `${browserCmd} sanal ekranda (${display}) başlatıldı.`,
      browser: browserCmd,
      url: targetUrl,
      display
    });
  } catch (err) {
    console.error('⚠️ Chrome launch handler error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/start-chrome', startChromeHandler);
app.get('/api/start-chrome', startChromeHandler);
app.post('/api/vds/launch-chrome', startChromeHandler);

// Install Linux application via apt-get or dpkg with real-time Socket.io log streaming
const installLinuxHandler = (req, res) => {
  try {
    const packageName = req.body?.packageName || req.body?.package || req.body?.name;
    const debPath = req.body?.debPath || req.body?.filePath;

    if (!packageName && !debPath) {
      return res.status(400).json({ success: false, error: 'Paket adı (packageName) veya .deb dosya yolu (debPath) belirtilmelidir.' });
    }

    let command = '';
    let targetLabel = '';

    if (debPath) {
      const safePath = getSafePath(debPath);
      if (!fs.existsSync(safePath)) {
        return res.status(404).json({ success: false, error: '.deb dosyası bulunamadı.' });
      }
      targetLabel = path.basename(safePath);
      command = `dpkg -i "${safePath}" || DEBIAN_FRONTEND=noninteractive apt-get install -f -y`;
    } else {
      // Clean package name to prevent shell injection
      const cleanPkg = packageName.trim().replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!cleanPkg) {
        return res.status(400).json({ success: false, error: 'Geçersiz paket adı.' });
      }
      targetLabel = cleanPkg;
      command = `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${cleanPkg}`;
    }

    console.log(`📦 Starting Linux package installation: ${targetLabel}`);

    // Notify clients that installation has started
    io.emit('install-log', {
      target: targetLabel,
      log: `\n=== [VDS PAKET YÜKLEYİCİ] ${targetLabel} Kurulumu Başlatılıyor... ===\nCommand: ${command}\n\n`
    });

    const child = childSpawn('sh', ['-c', command], {
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
    });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      io.emit('install-log', { target: targetLabel, log: text });
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      io.emit('install-log', { target: targetLabel, log: text });
    });

    child.on('close', (code) => {
      const success = code === 0;
      console.log(`📦 Installation finished for ${targetLabel} with exit code ${code}`);
      io.emit('install-complete', {
        target: targetLabel,
        success,
        code,
        message: success ? `"${targetLabel}" başarıyla yüklendi!` : `Kurulum sırasında hata oluştu (Exit Code: ${code}).`
      });
    });

    res.json({
      success: true,
      message: `"${targetLabel}" için kurulum başlatıldı, loglar canlı aktarılıyor.`,
      target: targetLabel
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/install-linux', installLinuxHandler);
app.post('/api/vds/install-linux', installLinuxHandler);

// Launch any Linux GUI application on VDS display (:99)
app.post('/api/vds/launch-app', (req, res) => {
  try {
    const appCmd = req.body?.appCmd || req.body?.cmd || req.body?.app;
    if (!appCmd) {
      return res.status(400).json({ success: false, error: 'Uygulama komutu gerekli.' });
    }

    const display = process.env.DISPLAY || ':99';
    const cleanCmd = appCmd.trim();
    const fullCmd = `DISPLAY=${display} ${cleanCmd} &`;

    console.log(`🚀 Launching VDS GUI App: ${fullCmd}`);
    childExec(fullCmd, (err) => {
      if (err) console.warn(`⚠️ Launch warning for ${cleanCmd}:`, err.message);
    });

    res.json({
      success: true,
      message: `"${cleanCmd}" VDS ekranında (:99) başlatıldı.`,
      appCmd: cleanCmd,
      display
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check installed VDS software list
app.get('/api/vds/installed-apps', async (req, res) => {
  try {
    const appsToCheck = [
      { id: 'chrome', name: 'Google Chrome', cmd: 'google-chrome-stable', icon: 'fa-brands fa-chrome', color: 'text-blue-400', category: 'Internet' },
      { id: 'vlc', name: 'VLC Media Player', cmd: 'vlc', icon: 'fa-solid fa-file-video', color: 'text-orange-400', category: 'Medya' },
      { id: 'gimp', name: 'GIMP Görsel Düzenleyici', cmd: 'gimp', icon: 'fa-solid fa-paintbrush', color: 'text-purple-400', category: 'Grafik' },
      { id: 'firefox', name: 'Firefox Web Tarayıcı', cmd: 'firefox', icon: 'fa-brands fa-firefox', color: 'text-orange-500', category: 'Internet' },
      { id: 'wine', name: 'Wine (.exe Çalıştırıcı)', cmd: 'wine', icon: 'fa-brands fa-windows', color: 'text-indigo-400', category: 'Sistem' },
      { id: 'htop', name: 'Htop Sistem İzleyici', cmd: 'htop', icon: 'fa-solid fa-microchip', color: 'text-emerald-400', category: 'Sistem' },
      { id: 'neofetch', name: 'Neofetch Bilgi Ekranı', cmd: 'neofetch', icon: 'fa-solid fa-terminal', color: 'text-cyan-400', category: 'Sistem' },
      { id: 'libreoffice', name: 'LibreOffice Ofis Paketi', cmd: 'libreoffice', icon: 'fa-solid fa-file-word', color: 'text-blue-500', category: 'Ofis' }
    ];

    const results = await Promise.all(appsToCheck.map(app => {
      return new Promise((resolve) => {
        childExec(`which ${app.cmd}`, (err) => {
          resolve({ ...app, installed: !err });
        });
      });
    }));

    res.json({ success: true, apps: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check VDS Status (Xvfb, Chrome, Wine availability)
app.get('/api/vds/status', (req, res) => {
  const display = process.env.DISPLAY || ':99';
  const chromePath = '/usr/bin/google-chrome-stable';
  const winePath = '/usr/bin/wine';

  res.json({
    success: true,
    display,
    chromeAvailable: fs.existsSync(chromePath) || fs.existsSync('/usr/bin/google-chrome'),
    wineAvailable: fs.existsSync(winePath) || fs.existsSync('/usr/local/bin/wine'),
    platform: os.platform(),
    isLinux: os.platform() === 'linux'
  });
});

// ==========================================
// 3. SYSTEM METRICS API (Sistem Monitörü)
// ==========================================
app.get('/api/system/stats', (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercent = Math.round((usedMem / totalMem) * 100);

    res.json({
      success: true,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        release: os.release(),
        uptime: Math.floor(os.uptime()),
        cpusCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Generic CPU',
        loadAvg: os.loadavg()
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        percentage: memoryPercent
      },
      process: {
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all route to serve the WebOS single page application
app.get('*', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('WebOS public interface not found.');
  }
});

// ==========================================
// 4. PORT & SERVER BOOTSTRAP
// ==========================================
const PORT = 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 WebOS Cloud Server running on http://0.0.0.0:${PORT}`);
  console.log(`🖥️  Platform: ${os.platform()} (${os.arch()})`);
  console.log(`📁 Workspace Root: ${WORKSPACE_ROOT}`);
  console.log(`⚡ Bound to Port: ${PORT}`);
  console.log(`==================================================`);
});
