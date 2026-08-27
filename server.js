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

// Import node-pty dynamically or gracefully handle child_process fallback
let ptyModule = null;
try {
  ptyModule = require('node-pty');
  console.log('✅ Native PTY engine loaded.');
} catch (err) {
  // Graceful fallback to built-in child_process terminal emulator (used in cloud/sandbox environments)
  ptyModule = null;
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
  changeOrigin: true,
  logLevel: 'silent',
  onError: (err, req, socket) => {
    // Avoid crashing HTTP server on socket aborts
    try {
      if (socket && socket.destroy) socket.destroy();
    } catch (e) {}
  }
});
app.use('/websockify', wsProxy);
app.use('/vnc', wsProxy);

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/websockify') || url.startsWith('/novnc') || url.startsWith('/vnc')) {
    try {
      wsProxy.upgrade(req, socket, head);
    } catch (err) {
      try { socket.destroy(); } catch (e) {}
    }
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
const launchChromeHandler = (req, res) => {
  try {
    const url = req.body?.url || req.query?.url || 'https://www.google.com';
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
};

app.post('/api/vds/launch-chrome', launchChromeHandler);
app.post('/api/start-chrome', launchChromeHandler);

// ==========================================
// DIRECT TRANSPARENT WEB & GOOGLE PROXY ENGINE
// ==========================================
const handleBrowserProxy = async (req, res) => {
  try {
    let targetUrl = req.query.url || req.query.q || req.query.search;

    if (!targetUrl || targetUrl.trim() === '') {
      targetUrl = 'https://www.google.com';
    }

    targetUrl = targetUrl.trim();

    // If query is not a direct URL, format as Google search URL
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = 'https://' + targetUrl;
      } else {
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
      }
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

    // Remove frame-busting security headers from response so browser can render in WebOS
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

      // Injected script to keep navigation and form submissions within the WebOS Chrome proxy
      const interceptScript = `
        <script>
          (function() {
            try {
              window.parent.postMessage({ type: 'browser-url', url: ${JSON.stringify(targetUrl)} }, '*');
            } catch(e) {}

            document.addEventListener('click', function(e) {
              const a = e.target.closest('a');
              if (a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')) {
                e.preventDefault();
                let fullUrl = a.href;
                try {
                  fullUrl = new URL(a.getAttribute('href') || a.href, ${JSON.stringify(targetUrl)}).href;
                } catch(err) {}
                window.location.href = '/api/proxy?url=' + encodeURIComponent(fullUrl);
              }
            }, true);

            document.addEventListener('submit', function(e) {
              const form = e.target.closest('form');
              if (form) {
                e.preventDefault();
                let action = form.getAttribute('action') || window.location.href;
                try {
                  action = new URL(action, ${JSON.stringify(targetUrl)}).href;
                } catch(err) {}
                const formData = new FormData(form);
                const params = new URLSearchParams(formData);
                const method = (form.method || 'GET').toUpperCase();
                const sep = action.includes('?') ? '&' : '?';
                window.location.href = '/api/proxy?url=' + encodeURIComponent(action + sep + params.toString());
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
    console.error('⚠️ Proxy Error:', err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { background: #202124; color: #f8fafc; font-family: Roboto, sans-serif; padding: 2rem; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .err-box { max-width: 500px; width: 100%; background: #303134; padding: 2rem; border-radius: 1rem; border: 1px solid #5f6368; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          h2 { color: #f28b82; margin-top: 0; font-size: 1.25rem; }
          p { color: #bdc1c6; font-size: 0.875rem; }
          code { background: #202124; padding: 0.5rem 0.75rem; border-radius: 0.5rem; color: #8ab4f8; display: block; margin: 1rem 0; word-break: break-all; font-family: monospace; font-size: 0.8rem; border: 1px solid #3c4043; }
          .btn-home { display: inline-block; background: #8ab4f8; color: #202124; padding: 0.5rem 1rem; border-radius: 4px; font-weight: 500; text-decoration: none; margin-top: 1rem; }
        </style>
      </head>
      <body>
        <div class="err-box">
          <h2>⚠️ Web Sayfası Yüklenemedi</h2>
          <p>İstenen siteye bağlanırken bir sorun oluştu:</p>
          <code>${req.query.q || req.query.url || ''}</code>
          <p style="font-size: 0.8rem; color: #9aa0a6;">Hata: ${err.message}</p>
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

// ==========================================
// REAL PACKAGE SEARCH & REPOSITORY REGISTRY APIS (NPM, APT, PyPI)
// ==========================================

// Global state file for dynamic desktop installed applications
const INSTALLED_PACKAGES_FILE = path.join(WORKSPACE_ROOT, '.installed_apps.json');

function getInstalledAppRegistry() {
  try {
    if (fs.existsSync(INSTALLED_PACKAGES_FILE)) {
      return JSON.parse(fs.readFileSync(INSTALLED_PACKAGES_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveInstalledAppRegistry(apps) {
  try {
    fs.writeFileSync(INSTALLED_PACKAGES_FILE, JSON.stringify(apps, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not save installed apps file:', e.message);
  }
}

// Search online packages via real live npm registry API with fallback to Debian APT packages
app.get('/api/packages/search', async (req, res) => {
  try {
    const query = (req.query.q || req.query.query || '').trim();
    const type = req.query.type || 'npm'; // 'npm' | 'apt' | 'all'

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    const results = [];

    // 1. NPM Registry Live Search (Official API: registry.npmjs.org)
    try {
      const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=15&quality=0.8&popularity=1.0`;
      const npmRes = await fetch(npmUrl, {
        headers: { 'User-Agent': 'WebOS-PackageManager/1.0' }
      });

      if (npmRes.ok) {
        const npmData = await npmRes.json();
        const objects = npmData.objects || [];
        objects.forEach(item => {
          const pkg = item.package;
          results.push({
            name: pkg.name,
            version: pkg.version, // Stable latest release
            description: pkg.description || 'JavaScript / Node.js kütüphanesi',
            type: 'npm',
            author: pkg.publisher?.username || pkg.author?.name || 'npm topluluğu',
            date: pkg.date ? new Date(pkg.date).toLocaleDateString('tr-TR') : '',
            homepage: pkg.links?.homepage || pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
            score: Math.round((item.score?.final || 0.8) * 100),
            cmd: `npm install ${pkg.name}@${pkg.version}`,
            icon: 'fa-brands fa-node-js',
            color: 'text-emerald-400'
          });
        });
      }
    } catch (npmErr) {
      console.warn('NPM search error:', npmErr.message);
    }

    // 2. Curated Linux APT / CLI system tools search matching query
    const aptKnowledgeBase = [
      { name: 'vlc', version: '3.0.18-stable', description: 'VLC Media Player - Güçlü video & ses oynatıcı', type: 'apt', category: 'Medya', icon: 'fa-solid fa-file-video', color: 'text-orange-400', cmd: 'vlc' },
      { name: 'gimp', version: '2.10.34-stable', description: 'GIMP - Profesyonel görsel düzenleyici & tasarım aracı', type: 'apt', category: 'Grafik', icon: 'fa-solid fa-paintbrush', color: 'text-purple-400', cmd: 'gimp' },
      { name: 'firefox', version: '124.0-stable', description: 'Mozilla Firefox Web Tarayıcı', type: 'apt', category: 'Internet', icon: 'fa-brands fa-firefox', color: 'text-orange-500', cmd: 'firefox' },
      { name: 'htop', version: '3.2.2-stable', description: 'Htop - İnteraktif konsol işlem & kaynak monitörü', type: 'apt', category: 'Sistem', icon: 'fa-solid fa-microchip', color: 'text-emerald-400', cmd: 'htop' },
      { name: 'neofetch', version: '7.1.0-stable', description: 'Neofetch - Donanım & işletim sistemi bilgi terminali', type: 'apt', category: 'Sistem', icon: 'fa-solid fa-terminal', color: 'text-cyan-400', cmd: 'neofetch' },
      { name: 'ffmpeg', version: '6.0-stable', description: 'FFmpeg - Ses & video dönüştürme ve işleme kütüphanesi', type: 'apt', category: 'Medya', icon: 'fa-solid fa-film', color: 'text-red-400', cmd: 'ffmpeg' },
      { name: 'curl', version: '8.4.0-stable', description: 'cURL - HTTP/HTTPS veri transfer komut satırı aracı', type: 'apt', category: 'Ağ', icon: 'fa-solid fa-network-wired', color: 'text-blue-400', cmd: 'curl' },
      { name: 'git', version: '2.40.1-stable', description: 'Git - Dağıtık sürüm kontrol sistemi', type: 'apt', category: 'Geliştirici', icon: 'fa-brands fa-git-alt', color: 'text-rose-500', cmd: 'git' },
      { name: 'python3', version: '3.11.6-stable', description: 'Python 3 Programlama Dili ve Çalışma Ortamı', type: 'apt', category: 'Geliştirici', icon: 'fa-brands fa-python', color: 'text-yellow-400', cmd: 'python3' },
      { name: 'nano', version: '7.2-stable', description: 'GNU Nano - Terminal içi kullanımı kolay metin editörü', type: 'apt', category: 'Editör', icon: 'fa-solid fa-file-lines', color: 'text-teal-400', cmd: 'nano' },
      { name: 'tree', version: '2.1.0-stable', description: 'Tree - Dizin yapısını ağaç görünümünde listeleyici', type: 'apt', category: 'Sistem', icon: 'fa-solid fa-folder-tree', color: 'text-emerald-300', cmd: 'tree' },
      { name: 'tmux', version: '3.3a-stable', description: 'tmux - Terminal çoklayıcı & oturum yöneticisi', type: 'apt', category: 'Sistem', icon: 'fa-solid fa-table-columns', color: 'text-indigo-400', cmd: 'tmux' },
      { name: 'wget', version: '1.21.4-stable', description: 'Wget - İnternetten dosya indirme aracı', type: 'apt', category: 'Ağ', icon: 'fa-solid fa-download', color: 'text-sky-400', cmd: 'wget' },
      { name: 'zip', version: '3.0-stable', description: 'Zip / Unzip - Dosya sıkıştırma ve arşiv yöneticisi', type: 'apt', category: 'Araçlar', icon: 'fa-solid fa-file-zipper', color: 'text-amber-400', cmd: 'zip' },
      { name: 'jq', version: '1.6-stable', description: 'jq - Komut satırı JSON ayrıştırıcı ve biçimlendirici', type: 'apt', category: 'Geliştirici', icon: 'fa-solid fa-code', color: 'text-pink-400', cmd: 'jq' }
    ];

    const qLower = query.toLowerCase();
    const matchedApt = aptKnowledgeBase.filter(item => 
      item.name.toLowerCase().includes(qLower) || 
      item.description.toLowerCase().includes(qLower)
    );

    matchedApt.forEach(item => {
      // Prepend or add APT items
      results.unshift({
        name: item.name,
        version: item.version,
        description: item.description,
        type: 'apt',
        author: 'Debian / Ubuntu Stable Repositories',
        category: item.category,
        cmd: `apt-get install -y ${item.name}`,
        icon: item.icon,
        color: item.color,
        score: 95
      });
    });

    res.json({
      success: true,
      query,
      count: results.length,
      results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Install package (NPM, APT or Custom) and register to WebOS Desktop dynamically
app.post('/api/packages/install', async (req, res) => {
  try {
    const { name, type, version, cmd, description, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Paket adı zorunludur.' });
    }

    const cleanName = name.trim();
    const pkgType = type || 'npm';
    let installCommand = '';

    if (pkgType === 'npm') {
      // Install real npm package with exact stable version
      const versionSpec = version ? `@${version}` : '';
      installCommand = `npm install ${cleanName}${versionSpec} --save`;
    } else if (pkgType === 'apt') {
      installCommand = `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${cleanName}`;
    } else {
      installCommand = cmd || `npm install ${cleanName}`;
    }

    console.log(`📦 Starting installation [${pkgType}]: ${cleanName} (Cmd: ${installCommand})`);

    // Stream logs to UI
    io.emit('install-log', {
      target: cleanName,
      log: `\n=== [PAKET KURUCU] ${cleanName} (${pkgType.toUpperCase()}) Kurulumu Başlatılıyor... ===\nKomut: ${installCommand}\n\n`
    });

    const child = childSpawn('sh', ['-c', installCommand], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
    });

    child.stdout.on('data', (data) => {
      io.emit('install-log', { target: cleanName, log: data.toString() });
    });

    child.stderr.on('data', (data) => {
      io.emit('install-log', { target: cleanName, log: data.toString() });
    });

    child.on('close', (code) => {
      const isSuccess = code === 0;
      console.log(`📦 Install exited with code ${code} for ${cleanName}`);

      if (isSuccess) {
        // Register to dynamic installed desktop apps
        const currentList = getInstalledAppRegistry();
        const existingIdx = currentList.findIndex(a => a.name.toLowerCase() === cleanName.toLowerCase());
        
        const newAppRecord = {
          id: `app-${cleanName.replace(/[^a-zA-Z0-9_-]/g, '')}`,
          name: cleanName,
          version: version || 'latest-stable',
          type: pkgType,
          description: description || `${cleanName} kütüphanesi`,
          icon: icon || (pkgType === 'npm' ? 'fa-brands fa-node-js' : 'fa-solid fa-box'),
          color: color || (pkgType === 'npm' ? 'text-emerald-400' : 'text-teal-400'),
          installedAt: Date.now(),
          cmd: cleanName
        };

        if (existingIdx >= 0) {
          currentList[existingIdx] = newAppRecord;
        } else {
          currentList.push(newAppRecord);
        }

        saveInstalledAppRegistry(currentList);

        // Broadcast to clients to add app to desktop and start menu
        io.emit('app-installed', newAppRecord);
      }

      io.emit('install-complete', {
        target: cleanName,
        success: isSuccess,
        code,
        message: isSuccess ? `"${cleanName}" başarıyla kuruldu ve masaüstüne eklendi!` : `Kurulum hatası (Kod: ${code})`
      });
    });

    res.json({
      success: true,
      message: `"${cleanName}" için kurulum süreci başlatıldı.`,
      packageName: cleanName
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic Desktop & Installed Apps list API
app.get('/api/packages/installed', (req, res) => {
  try {
    const list = getInstalledAppRegistry();
    res.json({ success: true, apps: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Remove installed dynamic app
app.post('/api/packages/uninstall', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Paket adı gerekli.' });

    let list = getInstalledAppRegistry();
    list = list.filter(a => a.name.toLowerCase() !== name.toLowerCase());
    saveInstalledAppRegistry(list);

    io.emit('app-uninstalled', { name });
    res.json({ success: true, message: `"${name}" masaüstünden kaldırıldı.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
