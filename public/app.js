// WebOS Core Operating System Script (Saf Vanilla JS - 60 FPS Performance)

document.addEventListener('DOMContentLoaded', () => {
  // Global System State
  let zIndexCount = 100;
  let activeAppId = null;
  let socket = window.io(); // Global socket instance for WebOS
  let term = null;
  let fitAddon = null;
  let currentFsDir = '';
  let currentFsItems = [];
  let selectedFileItem = null;

  // App Definition Map
  const APPS = {
    terminal: { title: 'Terminal', icon: 'fa-terminal', color: 'text-sky-400', el: document.getElementById('win-terminal') },
    files: { title: 'Dosya Yöneticisi', icon: 'fa-folder', color: 'text-amber-400', el: document.getElementById('win-files') },
    editor: { title: 'Not Defteri', icon: 'fa-note-sticky', color: 'text-emerald-400', el: document.getElementById('win-editor') },
    monitor: { title: 'Sistem Monitörü', icon: 'fa-chart-pie', color: 'text-purple-400', el: document.getElementById('win-monitor') },
    chrome: { title: 'Google Chrome', icon: 'fa-chrome', color: 'text-blue-400', el: document.getElementById('win-chrome') },
    software: { title: 'Yazılım Yöneticisi', icon: 'fa-box-open', color: 'text-teal-400', el: document.getElementById('win-software') },
    settings: { title: 'Ayarlar', icon: 'fa-sliders', color: 'text-rose-400', el: document.getElementById('win-settings') }
  };

  // ==========================================
  // 1. SYSTEM CLOCK & START MENU
  // ==========================================
  function updateClock() {
    const clockEl = document.getElementById('system-time');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('tr-TR');
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Start Menu Toggle
  const startBtn = document.getElementById('start-btn');
  const startMenu = document.getElementById('start-menu');

  function toggleStartMenu(show) {
    if (!startMenu) return;
    const shouldShow = show !== undefined ? show : startMenu.classList.contains('hidden');
    if (shouldShow) {
      startMenu.classList.remove('hidden');
      requestAnimationFrame(() => {
        startMenu.classList.add('show');
      });
    } else {
      startMenu.classList.remove('show');
      setTimeout(() => {
        if (!startMenu.classList.contains('show')) {
          startMenu.classList.add('hidden');
        }
      }, 150);
    }
  }

  if (startBtn && startMenu) {
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStartMenu();
    });

    document.addEventListener('click', (e) => {
      if (!startMenu.contains(e.target) && e.target !== startBtn) {
        toggleStartMenu(false);
      }
      hideContextMenus();
    });
  }

  // Desktop Refresh Button
  document.getElementById('btn-desktop-refresh')?.addEventListener('click', () => {
    if (!APPS.files.el.classList.contains('hidden')) {
      loadDirectory(currentFsDir);
    }
    toggleStartMenu(false);
  });

  // ==========================================
  // 2. WINDOW MANAGER (60 FPS Drag & Resize)
  // ==========================================
  function bringToFront(appKey) {
    const app = APPS[appKey];
    if (!app || !app.el) return;

    zIndexCount++;
    app.el.style.zIndex = zIndexCount;
    activeAppId = appKey;

    Object.values(APPS).forEach(a => a.el?.classList.remove('active'));
    app.el.classList.add('active');

    const activeTitleEl = document.getElementById('active-app-title');
    if (activeTitleEl) {
      activeTitleEl.innerHTML = `<i class="fa-solid ${app.icon} ${app.color}"></i> <span>${app.title}</span>`;
    }

    updateDock();
  }

  // Helper to ensure windows fit within screen viewport without overflowing
  function fitWindowToScreen(winEl) {
    if (!winEl) return;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    let currentWidth = winEl.offsetWidth || 800;
    let currentHeight = winEl.offsetHeight || 520;

    const maxW = Math.min(screenW - 24, currentWidth);
    const maxH = Math.min(screenH - 90, currentHeight);

    winEl.style.width = `${Math.max(340, maxW)}px`;
    winEl.style.height = `${Math.max(240, maxH)}px`;

    let currentLeft = winEl.offsetLeft;
    let currentTop = winEl.offsetTop;

    if (currentLeft + maxW > screenW - 12) {
      currentLeft = Math.max(12, screenW - maxW - 20);
    }
    if (currentTop + maxH > screenH - 70) {
      currentTop = Math.max(36, screenH - maxH - 70);
    }
    if (currentLeft < 10) currentLeft = 16;
    if (currentTop < 36) currentTop = 40;

    winEl.style.left = `${currentLeft}px`;
    winEl.style.top = `${currentTop}px`;
  }

  function openApp(appKey) {
    const app = APPS[appKey];
    if (!app || !app.el) return;

    app.el.classList.remove('hidden', 'minimized');
    bringToFront(appKey);
    fitWindowToScreen(app.el);

    if (appKey === 'terminal') {
      initTerminal();
      setTimeout(() => { if (term) term.focus(); }, 100);
    }
    if (appKey === 'files') loadDirectory('');
    if (appKey === 'monitor') fetchSystemStats();

    if (appKey === 'chrome') {
      initChromeVNC('https://www.google.com');
    }

    if (appKey === 'software') {
      initSoftwareCenter();
    }
  }

  function closeApp(appKey) {
    const app = APPS[appKey];
    if (!app || !app.el) return;

    app.el.classList.add('hidden');
    updateDock();
  }

  function toggleMinimizeApp(appKey) {
    const app = APPS[appKey];
    if (!app || !app.el) return;

    if (app.el.classList.contains('minimized')) {
      app.el.classList.remove('minimized');
      bringToFront(appKey);
      fitWindowToScreen(app.el);
    } else {
      app.el.classList.add('minimized');
    }
    updateDock();
  }

  function toggleMaximizeApp(appKey) {
    const app = APPS[appKey];
    if (!app || !app.el) return;

    app.el.classList.toggle('maximized');
    if (appKey === 'terminal' && fitAddon) {
      setTimeout(() => fitAddon.fit(), 200);
    }
  }

  // Attach Drag & Resize handlers to all App Windows
  Object.keys(APPS).forEach((appKey) => {
    const winEl = APPS[appKey].el;
    if (!winEl) return;

    // Ensure all 8 resize handles exist on the window element
    const HANDLE_TYPES = ['r', 'l', 'b', 't', 'br', 'bl', 'tr', 'tl'];
    HANDLE_TYPES.forEach((type) => {
      if (!winEl.querySelector(`.handle-${type}`)) {
        const handleDiv = document.createElement('div');
        handleDiv.className = `resize-handle handle-${type}`;
        winEl.appendChild(handleDiv);
      }
    });

    winEl.addEventListener('mousedown', () => bringToFront(appKey));
    winEl.addEventListener('touchstart', () => bringToFront(appKey), { passive: true });

    // 1. Header Dragging Logic (Mouse & Touch)
    const header = winEl.querySelector('.window-header');
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const startDrag = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      if (winEl.classList.contains('maximized')) return;

      isDragging = true;
      winEl.classList.add('is-dragging');
      document.body.classList.add('is-window-resizing');

      const clientX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
      const clientY = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;

      dragStartX = clientX;
      dragStartY = clientY;
      initialLeft = winEl.offsetLeft;
      initialTop = winEl.offsetTop;

      bringToFront(appKey);
    };

    if (header) {
      header.addEventListener('mousedown', startDrag);
      header.addEventListener('touchstart', startDrag, { passive: true });
    }

    // 2. Full 8-Directional Resizing Logic (Mouse & Touch)
    let isResizing = false;
    let resizeType = '';
    let resizeStartX = 0;
    let resizeStartY = 0;
    let initialWidth = 0;
    let initialHeight = 0;
    let resizeInitialLeft = 0;
    let resizeInitialTop = 0;

    const startResize = (e, type) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();

      isResizing = true;
      resizeType = type;
      winEl.classList.add('is-resizing');
      document.body.classList.add('is-window-resizing');

      const clientX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
      const clientY = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;

      resizeStartX = clientX;
      resizeStartY = clientY;
      initialWidth = winEl.offsetWidth;
      initialHeight = winEl.offsetHeight;
      resizeInitialLeft = winEl.offsetLeft;
      resizeInitialTop = winEl.offsetTop;

      bringToFront(appKey);
    };

    HANDLE_TYPES.forEach((type) => {
      const handle = winEl.querySelector(`.handle-${type}`);
      if (handle) {
        handle.addEventListener('mousedown', (e) => startResize(e, type));
        handle.addEventListener('touchstart', (e) => startResize(e, type), { passive: false });
      }
    });

    // Global Mouse / Touch Move & End Handlers
    let animationFrameId = null;

    const handleMove = (e) => {
      if (!isDragging && !isResizing) return;

      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      const clientX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
      const clientY = e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0;

      animationFrameId = requestAnimationFrame(() => {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        // DRAGGING
        if (isDragging) {
          const deltaX = clientX - dragStartX;
          const deltaY = clientY - dragStartY;
          const winW = winEl.offsetWidth;
          const winH = winEl.offsetHeight;

          const newLeft = Math.max(0, Math.min(screenW - winW, initialLeft + deltaX));
          const newTop = Math.max(32, Math.min(screenH - 60, initialTop + deltaY));

          winEl.style.left = `${newLeft}px`;
          winEl.style.top = `${newTop}px`;
        }

        // RESIZING (8 Directions)
        if (isResizing) {
          const deltaX = clientX - resizeStartX;
          const deltaY = clientY - resizeStartY;

          const minW = 340;
          const minH = 220;
          const maxW = screenW - 24;
          const maxH = screenH - 50;

          let newWidth = initialWidth;
          let newHeight = initialHeight;
          let newLeft = resizeInitialLeft;
          let newTop = resizeInitialTop;

          // Horizontal Resize
          if (resizeType.includes('r')) {
            newWidth = Math.max(minW, Math.min(maxW, initialWidth + deltaX));
            winEl.style.width = `${newWidth}px`;
          } else if (resizeType.includes('l')) {
            newWidth = Math.max(minW, Math.min(maxW, initialWidth - deltaX));
            newLeft = resizeInitialLeft + (initialWidth - newWidth);
            if (newLeft >= 0) {
              winEl.style.width = `${newWidth}px`;
              winEl.style.left = `${newLeft}px`;
            }
          }

          // Vertical Resize
          if (resizeType.includes('b')) {
            newHeight = Math.max(minH, Math.min(maxH, initialHeight + deltaY));
            winEl.style.height = `${newHeight}px`;
          } else if (resizeType.includes('t')) {
            newHeight = Math.max(minH, Math.min(maxH, initialHeight - deltaY));
            newTop = Math.max(32, resizeInitialTop + (initialHeight - newHeight));
            if (newTop >= 32) {
              winEl.style.height = `${newHeight}px`;
              winEl.style.top = `${newTop}px`;
            }
          }

          // Terminal & Canvas Auto-Fit
          if (appKey === 'terminal' && fitAddon) {
            fitAddon.fit();
          }
        }
      });
    };

    const handleEnd = () => {
      if (isDragging) {
        isDragging = false;
        winEl.classList.remove('is-dragging');
        document.body.classList.remove('is-window-resizing');
      }
      if (isResizing) {
        isResizing = false;
        winEl.classList.remove('is-resizing');
        document.body.classList.remove('is-window-resizing');
        if (appKey === 'terminal' && fitAddon) {
          fitAddon.fit();
        }
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('touchmove', handleMove, { passive: true });
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchend', handleEnd);

    // Window Control Buttons
    winEl.querySelector('.win-btn-close')?.addEventListener('click', () => closeApp(appKey));
    winEl.querySelector('.win-btn-min')?.addEventListener('click', () => toggleMinimizeApp(appKey));
    winEl.querySelector('.win-btn-max')?.addEventListener('click', () => toggleMaximizeApp(appKey));
  });

  // Desktop Icons Free Drag & Drop Setup
  function setupDesktopIconDragging() {
    const icons = document.querySelectorAll('.desktop-icon');
    if (!icons.length) return;

    let savedPositions = {};
    try {
      const raw = localStorage.getItem('webos_icon_positions');
      if (raw) savedPositions = JSON.parse(raw);
    } catch (e) {}

    icons.forEach((icon, index) => {
      const appKey = icon.getAttribute('data-app');
      
      icon.style.position = 'absolute';
      icon.style.zIndex = '15';

      if (savedPositions[appKey]) {
        icon.style.left = `${savedPositions[appKey].left}px`;
        icon.style.top = `${savedPositions[appKey].top}px`;
      } else {
        // Default layout: grid column starting top: 48px, left: 24px
        const defaultTop = 48 + index * 96;
        const defaultLeft = 24;
        icon.style.left = `${defaultLeft}px`;
        icon.style.top = `${defaultTop}px`;
      }

      let isIconDragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let draggedDistance = 0;

      const handleStart = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;

        isIconDragging = true;
        draggedDistance = 0;

        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);

        startX = clientX;
        startY = clientY;
        startLeft = icon.offsetLeft;
        startTop = icon.offsetTop;

        icon.classList.add('is-dragging');

        const handleMove = (moveEvent) => {
          if (!isIconDragging) return;
          const currX = moveEvent.clientX || (moveEvent.touches && moveEvent.touches[0].clientX);
          const currY = moveEvent.clientY || (moveEvent.touches && moveEvent.touches[0].clientY);

          const deltaX = currX - startX;
          const deltaY = currY - startY;

          draggedDistance = Math.hypot(deltaX, deltaY);

          const maxLeft = window.innerWidth - icon.offsetWidth - 12;
          const maxTop = window.innerHeight - icon.offsetHeight - 72;

          const newLeft = Math.max(12, Math.min(maxLeft, startLeft + deltaX));
          const newTop = Math.max(36, Math.min(maxTop, startTop + deltaY));

          icon.style.left = `${newLeft}px`;
          icon.style.top = `${newTop}px`;
        };

        const handleEnd = () => {
          if (!isIconDragging) return;
          isIconDragging = false;
          icon.classList.remove('is-dragging');

          document.removeEventListener('mousemove', handleMove);
          document.removeEventListener('mouseup', handleEnd);
          document.removeEventListener('touchmove', handleMove);
          document.removeEventListener('touchend', handleEnd);

          if (draggedDistance > 5) {
            savedPositions[appKey] = {
              left: icon.offsetLeft,
              top: icon.offsetTop
            };
            try {
              localStorage.setItem('webos_icon_positions', JSON.stringify(savedPositions));
            } catch (err) {}
          }
        };

        document.addEventListener('mousemove', handleMove);
        document.addEventListener('mouseup', handleEnd);
        document.addEventListener('touchmove', handleMove, { passive: true });
        document.addEventListener('touchend', handleEnd);
      };

      icon.addEventListener('mousedown', handleStart);
      icon.addEventListener('touchstart', handleStart, { passive: true });

      icon.addEventListener('click', (e) => {
        if (draggedDistance > 5) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        openApp(appKey);
        toggleStartMenu(false);
      });
    });
  }

  // Initialize Desktop Icon Dragging
  setupDesktopIconDragging();

  // Start Menu App Item Clicks
  document.querySelectorAll('.menu-app-item').forEach((item) => {
    item.addEventListener('click', () => {
      const appKey = item.getAttribute('data-app');
      openApp(appKey);
      toggleStartMenu(false);
    });
  });

  // ==========================================
  // 3. DOCK & TASKBAR
  // ==========================================
  function updateDock() {
    const dockContainer = document.getElementById('dock-container');
    if (!dockContainer) return;

    dockContainer.innerHTML = '';

    Object.keys(APPS).forEach((appKey) => {
      const app = APPS[appKey];
      const isVisible = app.el && !app.el.classList.contains('hidden');
      const isMinimized = app.el && app.el.classList.contains('minimized');

      const dockBtn = document.createElement('button');
      dockBtn.className = `dock-item relative w-10 h-10 rounded-xl flex items-center justify-center bg-slate-900 border border-slate-700/60 hover:bg-slate-800/90 transition-all ${
        isVisible ? 'running' : ''
      }`;
      dockBtn.title = app.title;
      dockBtn.innerHTML = `<i class="fa-solid ${app.icon} text-lg ${app.color}"></i>`;

      dockBtn.addEventListener('click', () => {
        if (!isVisible) {
          openApp(appKey);
        } else if (isMinimized) {
          toggleMinimizeApp(appKey);
        } else if (activeAppId === appKey) {
          toggleMinimizeApp(appKey);
        } else {
          bringToFront(appKey);
        }
      });

      dockContainer.appendChild(dockBtn);
    });
  }
  updateDock();

  // ==========================================
  // 4. CONTEXT MENUS (Right Click)
  // ==========================================
  const desktopEl = document.getElementById('desktop');
  const desktopCtx = document.getElementById('desktop-context-menu');
  const fileCtx = document.getElementById('file-context-menu');
  const procCtx = document.getElementById('proc-context-menu');

  function hideContextMenus() {
    desktopCtx?.classList.add('hidden');
    fileCtx?.classList.add('hidden');
    procCtx?.classList.add('hidden');
  }

  desktopEl?.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.app-window') || e.target.closest('#start-menu') || e.target.closest('footer')) return;
    e.preventDefault();
    hideContextMenus();

    if (desktopCtx) {
      desktopCtx.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
      desktopCtx.style.top = `${Math.min(e.clientY, window.innerHeight - 180)}px`;
      desktopCtx.classList.remove('hidden');
    }
  });

  // Desktop Context Actions
  document.getElementById('ctx-new-file')?.addEventListener('click', () => {
    hideContextMenus();
    openApp('files');
    document.getElementById('fm-new-file')?.click();
  });

  document.getElementById('ctx-new-folder')?.addEventListener('click', () => {
    hideContextMenus();
    openApp('files');
    document.getElementById('fm-new-folder')?.click();
  });

  document.getElementById('ctx-refresh')?.addEventListener('click', () => {
    hideContextMenus();
    if (!APPS.files.el.classList.contains('hidden')) loadDirectory(currentFsDir);
  });

  document.getElementById('ctx-open-terminal')?.addEventListener('click', () => {
    hideContextMenus();
    openApp('terminal');
  });

  // File Context Actions
  document.getElementById('ctx-file-open')?.addEventListener('click', () => {
    hideContextMenus();
    if (selectedFileItem) {
      if (selectedFileItem.isDirectory) {
        loadDirectory(selectedFileItem.path);
      } else {
        openFileInEditor(selectedFileItem.path);
      }
    }
  });

  document.getElementById('ctx-file-download')?.addEventListener('click', () => {
    hideContextMenus();
    if (selectedFileItem) {
      if (selectedFileItem.isDirectory) {
        alert('Klasörler doğrudan indirilemez, sadece dosyaları indirebilirsiniz.');
        return;
      }
      const downloadUrl = `/api/fs/download?file=${encodeURIComponent(selectedFileItem.path)}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = selectedFileItem.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });

  document.getElementById('ctx-file-rename')?.addEventListener('click', async () => {
    hideContextMenus();
    if (!selectedFileItem) return;
    const newName = prompt('Yeni ismi girin:', selectedFileItem.name);
    if (!newName || newName === selectedFileItem.name) return;

    const parentDir = selectedFileItem.path.substring(0, selectedFileItem.path.lastIndexOf('/'));
    const newPath = `${parentDir}/${newName}`;

    try {
      const res = await fetch('/api/fs/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: selectedFileItem.path, newPath })
      });
      const data = await res.json();
      if (data.success) {
        loadDirectory(currentFsDir);
      } else {
        alert(`Hata: ${data.error}`);
      }
    } catch (e) {
      alert(`Sunucu hatası: ${e.message}`);
    }
  });

  document.getElementById('ctx-file-delete')?.addEventListener('click', async () => {
    hideContextMenus();
    if (!selectedFileItem) return;
    if (!confirm(`'${selectedFileItem.name}' silinecek. Emin misiniz?`)) return;

    try {
      const res = await fetch(`/api/fs/delete?target=${encodeURIComponent(selectedFileItem.path)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        loadDirectory(currentFsDir);
      } else {
        alert(`Silme hatası: ${data.error}`);
      }
    } catch (e) {
      alert(`Sunucu hatası: ${e.message}`);
    }
  });

  // ==========================================
  // 5. TERMINAL (Socket.io + Xterm.js)
  // ==========================================
  function initTerminal() {
    if (term) {
      if (fitAddon) fitAddon.fit();
      setTimeout(() => term.focus(), 50);
      return;
    }

    const container = document.getElementById('xterm-container');
    if (!container) return;

    term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Courier New, Courier, monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#f8fafc',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)'
      }
    });

    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    if (!socket) socket = window.io();

    const startSession = () => {
      term.writeln('\r\n\x1b[32m✔ WebOS Cloud Terminal Oturumu Başlatıldı (Root Privileged).\x1b[0m\r\n');
      if (fitAddon && socket) {
        socket.emit('terminal-resize', { cols: term.cols, rows: term.rows });
      }
      if (socket) {
        socket.emit('terminal-input', '\r\n');
      }
    };

    if (socket.connected) {
      startSession();
    } else {
      socket.on('connect', startSession);
    }

    socket.on('terminal-output', (data) => {
      term.write(data);
    });

    term.onData((data) => {
      if (socket) {
        socket.emit('terminal-input', data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (socket) {
        socket.emit('terminal-resize', { cols, rows });
      }
    });

    // Ensure terminal gains keyboard focus when clicked
    const termWin = document.getElementById('win-terminal');
    if (termWin) {
      termWin.addEventListener('click', () => {
        if (term) term.focus();
      });
    }
    container.addEventListener('click', () => {
      if (term) term.focus();
    });

    window.addEventListener('resize', () => {
      if (fitAddon && !APPS.terminal.el.classList.contains('hidden')) {
        fitAddon.fit();
      }
    });

    document.getElementById('term-clear-btn')?.addEventListener('click', () => {
      term.clear();
      if (term) term.focus();
    });

    setTimeout(() => term.focus(), 150);
  }

  // ==========================================
  // 6. DOSYA YÖNETİCİSİ (FILE MANAGER)
  // ==========================================
  async function loadDirectory(dirPath = '') {
    try {
      const response = await fetch(`/api/fs/list?dir=${encodeURIComponent(dirPath)}`);
      const data = await response.json();

      if (!data.success) {
        alert(`Klasör okuma hatası: ${data.error}`);
        return;
      }

      currentFsDir = data.currentDir;
      currentFsItems = data.items;

      // Render Interactive Breadcrumbs
      renderBreadcrumbs(data.relativePath || '/');

      // Filter and render items
      filterAndRenderFiles();

      // Update Status Bar
      const countEl = document.getElementById('fm-status-count');
      const pathEl = document.getElementById('fm-status-path');
      if (countEl) countEl.textContent = `${data.items.length} öge`;
      if (pathEl) pathEl.textContent = `Path: ${data.currentDir || data.relativePath || '/'}`;

    } catch (err) {
      console.error('File Manager fetch error:', err);
    }
  }

  function renderBreadcrumbs(relativePath) {
    const container = document.getElementById('fm-path-segments');
    if (!container) return;

    container.innerHTML = '';
    const parts = relativePath.split('/').filter(Boolean);

    let accumulatedPath = '';
    parts.forEach((part, index) => {
      accumulatedPath += '/' + part;
      const targetPath = accumulatedPath;

      const btn = document.createElement('button');
      btn.className = 'hover:text-sky-400 font-medium font-mono text-slate-300 transition-colors p-0.5 rounded hover:bg-slate-800';
      btn.textContent = part;
      btn.addEventListener('click', () => loadDirectory(targetPath));

      container.appendChild(btn);

      if (index < parts.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'text-slate-600';
        sep.textContent = '/';
        container.appendChild(sep);
      }
    });
  }

  function filterAndRenderFiles() {
    const searchVal = document.getElementById('fm-search-input')?.value.toLowerCase().trim() || '';
    const grid = document.getElementById('fm-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const filtered = currentFsItems.filter(item => item.name.toLowerCase().includes(searchVal));

    filtered.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'file-card p-3 bg-slate-900/90 border border-slate-800/80 rounded-xl hover:border-sky-500/50 hover:bg-slate-800/80 cursor-pointer transition-all flex flex-col items-center justify-center text-center group relative';

      let iconClass = 'fa-file text-slate-400';
      if (item.isDirectory) {
        iconClass = 'fa-folder text-amber-400';
      } else {
        const ext = item.extension;
        if (['.js', '.ts', '.jsx', '.tsx', '.json'].includes(ext)) iconClass = 'fa-file-code text-emerald-400';
        else if (['.html', '.css'].includes(ext)) iconClass = 'fa-file-lines text-sky-400';
        else if (['.png', '.jpg', '.svg', '.gif'].includes(ext)) iconClass = 'fa-file-image text-purple-400';
        else if (ext === '.exe') iconClass = 'fa-brands fa-windows text-indigo-400';
        else if (ext === '.deb') iconClass = 'fa-box-archive text-teal-400';
        else if (ext === '.md' || ext === '.txt') iconClass = 'fa-file-lines text-slate-300';
      }

      card.innerHTML = `
        <i class="${iconClass.includes('fa-brands') ? iconClass : 'fa-solid ' + iconClass} text-3xl group-hover:scale-110 transition-transform"></i>
        <span class="text-xs font-medium text-slate-200 mt-2 truncate w-full" title="${item.name}">${item.name}</span>
        <span class="text-[10px] text-slate-500">${item.isDirectory ? 'Klasör' : formatBytes(item.size)}</span>
      `;

      // Double click to open
      card.addEventListener('dblclick', () => {
        if (item.isDirectory) {
          loadDirectory(item.path);
        } else if (item.extension === '.exe') {
          launchWineExe(item.path);
        } else if (item.extension === '.deb') {
          installDebPackage(item.path);
        } else {
          openFileInEditor(item.path);
        }
      });

      // Context menu right click
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedFileItem = item;
        hideContextMenus();

        if (fileCtx) {
          fileCtx.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
          fileCtx.style.top = `${Math.min(e.clientY, window.innerHeight - 150)}px`;
          fileCtx.classList.remove('hidden');
        }
      });

      grid.appendChild(card);
    });
  }

  // File Search Input Listener
  document.getElementById('fm-search-input')?.addEventListener('input', filterAndRenderFiles);

  // Home & Refresh
  document.getElementById('fm-btn-home')?.addEventListener('click', () => loadDirectory(''));
  document.getElementById('fm-refresh')?.addEventListener('click', () => loadDirectory(currentFsDir));

  // Create New File
  document.getElementById('fm-new-file')?.addEventListener('click', async () => {
    const filename = prompt('Yeni dosya adı girin (ör. not.txt):');
    if (!filename) return;

    const fullPath = `${currentFsDir}/${filename}`;
    try {
      const res = await fetch('/api/fs/create-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fullPath, content: '' })
      });
      const data = await res.json();
      if (data.success) {
        loadDirectory(currentFsDir);
      } else {
        alert(`Hata: ${data.error}`);
      }
    } catch (e) {
      alert(`Sunucu hatası: ${e.message}`);
    }
  });

  // Create New Folder
  document.getElementById('fm-new-folder')?.addEventListener('click', async () => {
    const folderName = prompt('Yeni klasör adı girin:');
    if (!folderName) return;

    const fullPath = `${currentFsDir}/${folderName}`;
    try {
      const res = await fetch('/api/fs/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: fullPath })
      });
      const data = await res.json();
      if (data.success) {
        loadDirectory(currentFsDir);
      } else {
        alert(`Hata: ${data.error}`);
      }
    } catch (e) {
      alert(`Sunucu hatası: ${e.message}`);
    }
  });

  // File Upload Helper
  async function uploadFilesToServer(files) {
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const uploadBtn = document.getElementById('fm-upload-btn');
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Yükleniyor...</span>';
    }

    try {
      const res = await fetch(`/api/fs/upload?dir=${encodeURIComponent(currentFsDir)}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        loadDirectory(currentFsDir);
      } else {
        alert(`Yükleme Hatası: ${data.error}`);
      }
    } catch (err) {
      alert(`Yükleme Sırasında Hata Oluştu: ${err.message}`);
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> <span>Dosya Yükle</span>';
      }
    }
  }

  // Trigger File Input Click
  const fmUploadBtn = document.getElementById('fm-upload-btn');
  const fmUploadInput = document.getElementById('fm-upload-input');

  fmUploadBtn?.addEventListener('click', () => fmUploadInput?.click());
  fmUploadInput?.addEventListener('change', (e) => {
    const input = e.target;
    if (input.files && input.files.length > 0) {
      uploadFilesToServer(input.files);
      input.value = ''; // Reset input selection
    }
  });

  // Drag and Drop Upload Handlers on File Manager Window
  const fmWinEl = document.getElementById('win-files');
  const fmDragOverlayEl = document.getElementById('fm-drag-overlay');

  if (fmWinEl) {
    let dragCounter = 0;

    fmWinEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (fmDragOverlayEl) fmDragOverlayEl.classList.remove('hidden');
    });

    fmWinEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    fmWinEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (fmDragOverlayEl) fmDragOverlayEl.classList.add('hidden');
      }
    });

    fmWinEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      if (fmDragOverlayEl) fmDragOverlayEl.classList.add('hidden');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFilesToServer(e.dataTransfer.files);
      }
    });
  }

  // ==========================================
  // 7. NOTEPAD / NOT DEFTERİ & METİN EDİTÖRÜ
  // ==========================================
  let activeEditingPath = null;
  let isEditorDirty = false;

  async function openFileInEditor(filePath) {
    try {
      const res = await fetch(`/api/fs/read?file=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!data.success) {
        alert(`Dosya açılamadı: ${data.error}`);
        return;
      }

      activeEditingPath = data.file;

      const filenameLabel = document.getElementById('editor-filename');
      const pathLabel = document.getElementById('editor-path-label');
      const textarea = document.getElementById('editor-textarea');

      if (filenameLabel) filenameLabel.textContent = data.name;
      if (pathLabel) pathLabel.textContent = data.file;
      if (textarea) textarea.value = data.content;

      setEditorDirty(false);
      updateEditorStats();
      openApp('editor');

    } catch (err) {
      alert(`Dosya okuma hatası: ${err.message}`);
    }
  }

  function setEditorDirty(dirty) {
    isEditorDirty = dirty;
    const badge = document.getElementById('editor-dirty-badge');
    if (badge) {
      if (dirty) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }
  }

  const editorTextarea = document.getElementById('editor-textarea');
  function updateEditorStats() {
    if (!editorTextarea) return;
    const text = editorTextarea.value;
    const lines = text.split('\n').length;
    const chars = text.length;

    const lineCountEl = document.getElementById('editor-line-count');
    const charCountEl = document.getElementById('editor-char-count');

    if (lineCountEl) lineCountEl.textContent = `${lines} Satır`;
    if (charCountEl) charCountEl.textContent = `${chars} Karakter`;
  }

  if (editorTextarea) {
    editorTextarea.addEventListener('input', () => {
      setEditorDirty(true);
      updateEditorStats();
    });
  }

  // New Scratchpad Action
  document.getElementById('editor-new-btn')?.addEventListener('click', () => {
    if (isEditorDirty && !confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?')) return;
    activeEditingPath = null;
    if (editorTextarea) editorTextarea.value = '';
    document.getElementById('editor-filename').textContent = 'isimsiz.txt';
    document.getElementById('editor-path-label').textContent = 'Yeni Dosya';
    setEditorDirty(false);
    updateEditorStats();
  });

  // Save File Action
  async function saveActiveFile() {
    if (!activeEditingPath) {
      const newPath = prompt('Kaydedilecek dosya adını/yolunu yazın (ör. not.txt):');
      if (!newPath) return;
      activeEditingPath = newPath.startsWith('/') ? newPath : `${currentFsDir || '.'}/${newPath}`;
    }

    const content = editorTextarea?.value || '';

    try {
      const res = await fetch('/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activeEditingPath, content: content })
      });
      const data = await res.json();

      if (data.success) {
        setEditorDirty(false);
        const name = activeEditingPath.split('/').pop() || activeEditingPath;
        document.getElementById('editor-filename').textContent = name;
        document.getElementById('editor-path-label').textContent = activeEditingPath;
        if (!APPS.files.el.classList.contains('hidden')) {
          loadDirectory(currentFsDir);
        }
      } else {
        alert(`Kaydetme hatası: ${data.error}`);
      }
    } catch (err) {
      alert(`Sunucu hatası: ${err.message}`);
    }
  }

  document.getElementById('editor-save-btn')?.addEventListener('click', saveActiveFile);

  // Ctrl+S Keyboard Shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (activeAppId === 'editor') {
        saveActiveFile();
      }
    }
  });

  // ==========================================
  // 8. REAL-TIME TASK MANAGER & SYSTEM METRICS
  // ==========================================
  
  // Tab Switching Logic (Windows 11 Task Manager style)
  const tmTabBtns = document.querySelectorAll('.tm-tab-btn');
  const tmViews = document.querySelectorAll('.tm-view');

  tmTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      
      tmTabBtns.forEach(b => {
        b.classList.remove('active');
        b.classList.replace('text-slate-300', 'text-slate-400');
      });
      btn.classList.add('active');
      btn.classList.replace('text-slate-400', 'text-slate-300');

      tmViews.forEach(v => v.classList.add('hidden'));
      const targetView = document.getElementById(`tm-view-${tabName}`);
      if (targetView) targetView.classList.remove('hidden');

      // Resize charts if performance tab is active
      if (tabName === 'perf') {
        setTimeout(() => {
          if (cpuChart) cpuChart.resize();
          if (ramChart) ramChart.resize();
          if (diskChart) diskChart.resize();
        }, 50);
      }
    });
  });

  // Chart.js Live Charts Initialization
  let cpuChart = null;
  let ramChart = null;
  let diskChart = null;

  function createMiniChart(canvasId, lineColor, bgGradientColor) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return null;

    const historyLength = 20;
    const initialLabels = Array(historyLength).fill('');
    const initialData = Array(historyLength).fill(0);

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: initialLabels,
        datasets: [{
          data: initialData,
          borderColor: lineColor,
          borderWidth: 2,
          fill: true,
          backgroundColor: bgGradientColor,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => ` ${context.parsed.y}%`
            }
          }
        },
        scales: {
          x: { display: false },
          y: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              stepSize: 50,
              callback: (val) => `${val}%`
            }
          }
        }
      }
    });
  }

  function initTaskCharts() {
    if (!window.Chart) return;
    if (cpuChart) return; // already initialized

    cpuChart = createMiniChart('chart-cpu', '#38bdf8', 'rgba(56, 189, 248, 0.12)');
    ramChart = createMiniChart('chart-ram', '#a855f7', 'rgba(168, 85, 247, 0.12)');
    diskChart = createMiniChart('chart-disk', '#f59e0b', 'rgba(245, 158, 11, 0.12)');
  }

  // Initialize charts
  initTaskCharts();

  // State for process filtering & right-click selection
  let latestProcesses = [];
  let selectedPid = null;

  function renderProcessesTable() {
    const procTableBody = document.getElementById('proc-table-body');
    const procCountEl = document.getElementById('proc-count');
    const searchInput = document.getElementById('proc-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (!procTableBody) return;

    const filtered = latestProcesses.filter((proc) => {
      if (!query) return true;
      return (
        proc.name.toLowerCase().includes(query) ||
        proc.pid.toString().includes(query)
      );
    });

    if (procCountEl) procCountEl.textContent = `${filtered.length} / ${latestProcesses.length} İşlem`;

    procTableBody.innerHTML = '';

    if (filtered.length === 0) {
      procTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-500 text-xs">Aramanıza uygun işlem bulunamadı.</td>
        </tr>
      `;
      return;
    }

    filtered.forEach((proc) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/60 transition-colors border-b border-slate-800/40 cursor-context-menu';
      tr.setAttribute('data-pid', proc.pid);
      tr.setAttribute('data-name', proc.name);

      tr.innerHTML = `
        <td class="p-2.5 text-sky-400 font-semibold font-mono">${proc.pid}</td>
        <td class="p-2.5 text-slate-200 truncate max-w-[180px] font-sans" title="${proc.name}">
          <i class="fa-solid fa-gear text-slate-500 mr-1.5 text-[10px]"></i>${proc.name}
        </td>
        <td class="p-2.5 text-emerald-400 font-semibold">${proc.cpu}%</td>
        <td class="p-2.5 text-purple-400">${proc.memory}% <span class="text-[10px] text-slate-500">(${proc.memRssMB} MB)</span></td>
        <td class="p-2.5 text-right">
          <button class="kill-proc-btn px-2.5 py-1 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg border border-rose-800/60 text-[10px] font-sans transition-all shadow-sm" data-pid="${proc.pid}" data-name="${proc.name}">
            <i class="fa-solid fa-xmark mr-1"></i>Sonlandır
          </button>
        </td>
      `;

      // Right-click context menu handler on process row
      tr.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        selectedPid = proc.pid;
        hideContextMenus();

        const ctxProcInfo = document.getElementById('ctx-proc-info');
        if (ctxProcInfo) ctxProcInfo.textContent = `PID: ${proc.pid} (${proc.name})`;

        const procCtxMenu = document.getElementById('proc-context-menu');
        if (procCtxMenu) {
          procCtxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
          procCtxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 100)}px`;
          procCtxMenu.classList.remove('hidden');
        }
      });

      procTableBody.appendChild(tr);
    });

    // End task buttons in table
    procTableBody.querySelectorAll('.kill-proc-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = Number(btn.getAttribute('data-pid'));
        const name = btn.getAttribute('data-name');
        if (confirm(`"${name}" (PID ${pid}) işlemini sonlandırmak istediğinizden emin misiniz?`)) {
          socket.emit('kill-process', { pid });
        }
      });
    });
  }

  // Filter input event listener
  document.getElementById('proc-search-input')?.addEventListener('input', renderProcessesTable);

  // Context Menu "End Task" click
  document.getElementById('ctx-proc-kill')?.addEventListener('click', () => {
    if (selectedPid) {
      if (confirm(`PID ${selectedPid} işlemini sonlandırmak istediğinizden emin misiniz?`)) {
        socket.emit('kill-process', { pid: selectedPid });
      }
    }
    hideContextMenus();
  });

  // Socket.io Real-Time System Metrics Handler
  if (socket) {
    socket.on('system-metrics', (data) => {
      if (!data) return;

      initTaskCharts();

      // 1. Hardware Specs Footers & Sidebar
      if (data.hardware) {
        const sideCpu = document.getElementById('tm-side-cpu');
        const sideRam = document.getElementById('tm-side-ram');
        const sideDisk = document.getElementById('tm-side-disk');

        const footCpu = document.getElementById('tm-footer-cpu');
        const footCores = document.getElementById('tm-footer-cores');
        const footRam = document.getElementById('tm-footer-ram');
        const footDisk = document.getElementById('tm-footer-disk');

        if (sideCpu) sideCpu.textContent = data.hardware.cpuModel || 'CPU';
        if (sideRam) sideRam.textContent = `RAM: ${data.hardware.totalRamGB || 0} GB`;
        if (sideDisk) sideDisk.textContent = `Disk: ${data.hardware.totalDiskGB || 0} GB`;

        if (footCpu) footCpu.textContent = data.hardware.cpuModel || 'CPU';
        if (footCores) footCores.textContent = `Çekirdek: ${data.hardware.cores || '-'}`;
        if (footRam) footRam.textContent = `RAM: ${data.hardware.totalRamGB || 0} GB`;
        if (footDisk) footDisk.textContent = `Disk: ${data.hardware.totalDiskGB || 0} GB`;
      }

      // 2. CPU Gauge & Chart
      const cpuVal = Number(data.cpu.usagePercent) || 0;
      const cpuPercentEl = document.getElementById('sys-cpu-percent');
      const cpuBarEl = document.getElementById('sys-cpu-bar');
      const cpuModelEl = document.getElementById('sys-cpu-model');

      if (cpuPercentEl) cpuPercentEl.textContent = `${cpuVal.toFixed(1)}%`;
      if (cpuBarEl) cpuBarEl.style.width = `${Math.min(100, cpuVal)}%`;
      if (cpuModelEl) cpuModelEl.textContent = `${data.cpu.model} (${data.cpu.cores} Çekirdek)`;

      if (cpuChart) {
        cpuChart.data.labels.push('');
        cpuChart.data.labels.shift();
        cpuChart.data.datasets[0].data.push(cpuVal);
        cpuChart.data.datasets[0].data.shift();
        cpuChart.update('none');
      }

      // 3. RAM Gauge & Chart
      const ramVal = Number(data.memory.usagePercent) || 0;
      const memPercentEl = document.getElementById('sys-mem-percent');
      const memBarEl = document.getElementById('sys-mem-bar');
      const memTextEl = document.getElementById('sys-mem-text');

      if (memPercentEl) memPercentEl.textContent = `${ramVal.toFixed(1)}%`;
      if (memBarEl) memBarEl.style.width = `${Math.min(100, ramVal)}%`;
      if (memTextEl) {
        memTextEl.textContent = `${data.memory.usedMB} MB / ${data.memory.totalMB} MB (${(data.memory.totalMB / 1024).toFixed(1)} GB)`;
      }

      if (ramChart) {
        ramChart.data.labels.push('');
        ramChart.data.labels.shift();
        ramChart.data.datasets[0].data.push(ramVal);
        ramChart.data.datasets[0].data.shift();
        ramChart.update('none');
      }

      // Top bar memory icon tooltip
      const topMemIcon = document.getElementById('top-mem-icon');
      if (topMemIcon) topMemIcon.title = `Sistem Belleği: %${ramVal.toFixed(1)}`;

      // 4. Disk Gauge & Chart
      const diskVal = Number(data.disk.usagePercent) || 0;
      const diskPercentEl = document.getElementById('sys-disk-percent');
      const diskBarEl = document.getElementById('sys-disk-bar');
      const diskTextEl = document.getElementById('sys-disk-text');

      if (diskPercentEl) diskPercentEl.textContent = `${diskVal.toFixed(1)}%`;
      if (diskBarEl) diskBarEl.style.width = `${Math.min(100, diskVal)}%`;
      if (diskTextEl) {
        diskTextEl.textContent = `${data.disk.usedGB} GB / ${data.disk.totalGB} GB (${data.disk.mount})`;
      }

      if (diskChart) {
        diskChart.data.labels.push('');
        diskChart.data.labels.shift();
        diskChart.data.datasets[0].data.push(diskVal);
        diskChart.data.datasets[0].data.shift();
        diskChart.update('none');
      }

      // 5. Update Processes
      latestProcesses = data.processes || [];
      renderProcessesTable();
    });

    socket.on('kill-process-response', (res) => {
      if (res.success) {
        alert(`✔ ${res.message || 'İşlem başarıyla sonlandırıldı.'}`);
      } else {
        alert(`❌ İşlem sonlandırma hatası: ${res.error}`);
      }
    });
  }

  // ==========================================
  // 9. WEB BROWSER & REAL VNC CHROME ENGINE
  // ==========================================
  let rfbInstance = null;
  let RFBClass = null;

  async function loadRFBLibrary() {
    if (RFBClass) return RFBClass;
    if (window.RFB) {
      RFBClass = window.RFB;
      return RFBClass;
    }

    // 1. Local npm package served route (/vendor/novnc)
    try {
      const localModule = await import('/vendor/novnc/core/rfb.js');
      if (localModule && (localModule.default || localModule.RFB)) {
        RFBClass = localModule.default || localModule.RFB;
        return RFBClass;
      }
    } catch (err) {
      // Local module fallback
    }

    // 2. Fallback CDN loader
    try {
      const cdnModule = await import('https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/core/rfb.js');
      if (cdnModule && (cdnModule.default || cdnModule.RFB)) {
        RFBClass = cdnModule.default || cdnModule.RFB;
        return RFBClass;
      }
    } catch (err) {
      // CDN fallback
    }
    return null;
  }

  function resolveTargetUrl(rawUrl) {
    let url = (rawUrl || '').trim();
    if (!url) return 'https://www.google.com';

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // If it looks like a domain name (e.g. google.com, youtube.com, github.com)
    if (url.includes('.') && !url.includes(' ')) {
      return 'https://' + url;
    }

    // Otherwise treat as a search query
    return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(url)}`;
  }

  async function initChromeVNC(initialUrl) {
    const container = document.getElementById('chrome-vnc-container');
    const statusEl = document.getElementById('chrome-vnc-status');
    const iframeEl = document.getElementById('chrome-iframe');
    const canvasEl = document.getElementById('chrome-vnc-canvas');
    const chromeUrlInput = document.getElementById('chrome-url-input');
    if (!container) return;

    const targetUrl = resolveTargetUrl(initialUrl || chromeUrlInput?.value || 'https://www.google.com');

    if (chromeUrlInput) {
      chromeUrlInput.value = targetUrl;
    }

    // Function to activate Web Browser Proxy Iframe mode
    const loadWebIframeMode = () => {
      if (canvasEl) canvasEl.classList.add('hidden');
      if (iframeEl) {
        iframeEl.classList.remove('hidden');
        iframeEl.src = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      }
      if (statusEl) statusEl.classList.add('hidden');
    };

    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = `
        <div class="w-10 h-10 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3"></div>
        <p class="text-xs font-medium text-slate-300">Web Tarayıcısı Açılıyor...</p>
      `;
    }

    // Inform backend
    try {
      fetch('/api/start-chrome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      }).catch(() => {});
    } catch (err) {}

    // Check VNC server status
    let isVncServerActive = false;
    try {
      const vncRes = await fetch('/api/vnc-status');
      const vncData = await vncRes.json();
      isVncServerActive = !!vncData.active;
    } catch (e) {
      isVncServerActive = false;
    }

    if (!isVncServerActive) {
      loadWebIframeMode();
      return;
    }

    // VNC server active -> Attempt RFB stream connection
    if (iframeEl) iframeEl.classList.add('hidden');
    if (canvasEl) canvasEl.classList.remove('hidden');

    let RFB = null;
    try {
      RFB = await loadRFBLibrary();
    } catch (e) {}

    if (!RFB) {
      loadWebIframeMode();
      return;
    }

    if (rfbInstance) {
      if (statusEl) statusEl.classList.add('hidden');
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/vnc`;

    try {
      rfbInstance = new RFB(container, wsUrl, {
        credentials: { password: '' }
      });

      rfbInstance.scaleViewport = true;
      rfbInstance.resizeSession = false;
      rfbInstance.clipToWindow = true;

      rfbInstance.addEventListener('connect', () => {
        if (statusEl) statusEl.classList.add('hidden');
      });

      rfbInstance.addEventListener('disconnect', (e) => {
        rfbInstance = null;
        loadWebIframeMode();
      });

      rfbInstance.addEventListener('credentialsrequired', () => {
        rfbInstance.sendCredentials({ password: '' });
      });

    } catch (err) {
      rfbInstance = null;
      loadWebIframeMode();
    }
  }

  function navigateChrome(explicitUrl) {
    const chromeUrlInput = document.getElementById('chrome-url-input');
    const iframeEl = document.getElementById('chrome-iframe');
    const rawQuery = explicitUrl || chromeUrlInput?.value;
    const targetUrl = resolveTargetUrl(rawQuery);

    if (chromeUrlInput) {
      chromeUrlInput.value = targetUrl;
    }

    if (iframeEl && !iframeEl.classList.contains('hidden')) {
      iframeEl.src = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    } else {
      initChromeVNC(targetUrl);
    }
  }

  document.getElementById('chrome-btn-go')?.addEventListener('click', () => navigateChrome());
  document.getElementById('chrome-url-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateChrome();
  });

  document.getElementById('chrome-btn-home')?.addEventListener('click', () => {
    navigateChrome('https://www.google.com');
  });

  document.getElementById('chrome-btn-back')?.addEventListener('click', () => {
    const iframeEl = document.getElementById('chrome-iframe');
    if (iframeEl && !iframeEl.classList.contains('hidden') && iframeEl.contentWindow) {
      try { iframeEl.contentWindow.history.back(); } catch (e) {}
    }
  });

  document.getElementById('chrome-btn-forward')?.addEventListener('click', () => {
    const iframeEl = document.getElementById('chrome-iframe');
    if (iframeEl && !iframeEl.classList.contains('hidden') && iframeEl.contentWindow) {
      try { iframeEl.contentWindow.history.forward(); } catch (e) {}
    }
  });

  document.getElementById('chrome-btn-reload')?.addEventListener('click', () => {
    const iframeEl = document.getElementById('chrome-iframe');
    if (iframeEl && !iframeEl.classList.contains('hidden')) {
      iframeEl.src = iframeEl.src;
    } else {
      if (rfbInstance) {
        try { rfbInstance.disconnect(); } catch (e) {}
        rfbInstance = null;
      }
      initChromeVNC(document.getElementById('chrome-url-input')?.value || 'https://www.google.com');
    }
  });

  // Bookmark shortcuts
  document.querySelectorAll('.chrome-bm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (url) navigateChrome(url);
    });
  });

  async function launchWineExe(filePath) {
    if (!filePath) return;
    try {
      const res = await fetch('/api/run-exe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      });
      const data = await res.json();
      if (data.success) {
        alert(`🍷 Wine Uygulaması Başlatıldı: ${data.message}`);
      } else {
        alert(`Wine Hatası: ${data.error}`);
      }
    } catch (err) {
      alert(`Wine Bağlantı Hatası: ${err.message}`);
    }
  }

  // File Context Menu: Wine .exe Launch Option
  document.getElementById('ctx-file-wine')?.addEventListener('click', () => {
    hideContextMenus();
    if (selectedFileItem) {
      launchWineExe(selectedFileItem.path);
    }
  });

  // File Context Menu: .deb Package Install Option
  document.getElementById('ctx-file-deb')?.addEventListener('click', () => {
    hideContextMenus();
    if (selectedFileItem) {
      installDebPackage(selectedFileItem.path);
    }
  });

  // ==========================================
  // 10. SOFTWARE CENTER & PACKAGE INSTALLER LOGIC
  // ==========================================
  let softwareCenterInitialized = false;

  function initSoftwareCenter() {
    if (!softwareCenterInitialized) {
      setupSoftwareCenterTabs();
      setupSoftwareCenterEvents();
      setupSocketInstallListeners();
      softwareCenterInitialized = true;
    }
    fetchInstalledApps();
  }

  function setupSoftwareCenterTabs() {
    const tabStoreBtn = document.getElementById('sw-tab-store');
    const tabInstallerBtn = document.getElementById('sw-tab-installer');
    const viewStore = document.getElementById('sw-view-store');
    const viewInstaller = document.getElementById('sw-view-installer');

    tabStoreBtn?.addEventListener('click', () => {
      tabStoreBtn.classList.add('bg-teal-600', 'text-white');
      tabStoreBtn.classList.remove('bg-slate-800', 'text-slate-300');
      tabInstallerBtn?.classList.add('bg-slate-800', 'text-slate-300');
      tabInstallerBtn?.classList.remove('bg-teal-600', 'text-white');

      viewStore?.classList.remove('hidden');
      viewInstaller?.classList.add('hidden');
    });

    tabInstallerBtn?.addEventListener('click', () => {
      tabInstallerBtn.classList.add('bg-teal-600', 'text-white');
      tabInstallerBtn.classList.remove('bg-slate-800', 'text-slate-300');
      tabStoreBtn?.classList.add('bg-slate-800', 'text-slate-300');
      tabStoreBtn?.classList.remove('bg-teal-600', 'text-white');

      viewInstaller?.classList.remove('hidden');
      viewStore?.classList.add('hidden');
    });
  }

  function setupSoftwareCenterEvents() {
    // Quick Apt Install Input
    const quickBtn = document.getElementById('sw-quick-apt-btn');
    const quickInput = document.getElementById('sw-quick-apt-input');

    quickBtn?.addEventListener('click', () => {
      const pkg = quickInput?.value.trim();
      if (pkg) {
        installLinuxPackage(pkg);
        if (quickInput) quickInput.value = '';
      }
    });

    quickInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const pkg = quickInput?.value.trim();
        if (pkg) {
          installLinuxPackage(pkg);
          if (quickInput) quickInput.value = '';
        }
      }
    });

    // Custom Apt Install Box
    document.getElementById('sw-custom-pkg-btn')?.addEventListener('click', () => {
      const input = document.getElementById('sw-custom-pkg-input');
      const pkg = input?.value.trim();
      if (pkg) {
        installLinuxPackage(pkg);
        if (input) input.value = '';
      }
    });

    // Custom DEB Install Box
    document.getElementById('sw-custom-deb-btn')?.addEventListener('click', () => {
      const input = document.getElementById('sw-custom-deb-input');
      const debPath = input?.value.trim();
      if (debPath) {
        installDebPackage(debPath);
        if (input) input.value = '';
      }
    });

    // Refresh Apps
    document.getElementById('sw-refresh-apps-btn')?.addEventListener('click', fetchInstalledApps);

    // Clear Terminal Log
    document.getElementById('sw-clear-log-btn')?.addEventListener('click', () => {
      const term = document.getElementById('sw-install-log-terminal');
      if (term) term.textContent = 'Loglar temizlendi.\n';
    });
  }

  async function fetchInstalledApps() {
    const grid = document.getElementById('sw-apps-grid');
    if (!grid) return;

    try {
      const res = await fetch('/api/vds/installed-apps');
      const data = await res.json();

      if (!data.success || !data.apps) return;

      grid.innerHTML = '';
      data.apps.forEach(app => {
        const card = document.createElement('div');
        card.className = 'bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm';

        card.innerHTML = `
          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center">
                <i class="${app.icon} text-xl ${app.color}"></i>
              </div>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${app.installed ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-950 text-slate-400 border border-slate-800'}">
                ${app.installed ? '● YÜKLÜ' : 'KULANILABİLİR'}
              </span>
            </div>
            <h4 class="text-xs font-semibold text-slate-100">${app.name}</h4>
            <p class="text-[10px] text-slate-400 mt-0.5">Kategori: ${app.category} (${app.cmd})</p>
          </div>

          <div class="mt-3 flex items-center space-x-2">
            ${app.installed ? `
              <button class="sw-run-btn flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center space-x-1" data-cmd="${app.cmd}" data-id="${app.id}">
                <i class="fa-solid fa-play text-[10px]"></i>
                <span>Çalıştır</span>
              </button>
            ` : `
              <button class="sw-install-btn flex-1 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center space-x-1" data-cmd="${app.cmd}">
                <i class="fa-solid fa-download text-[10px]"></i>
                <span>Sistemine Yükle</span>
              </button>
            `}
          </div>
        `;

        grid.appendChild(card);
      });

      // Attach event handlers for Run & Install
      grid.querySelectorAll('.sw-run-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const cmd = btn.getAttribute('data-cmd');
          const id = btn.getAttribute('data-id');
          if (id === 'chrome') {
            openApp('chrome');
          } else if (id === 'wine') {
            alert('Wine hazır! .exe dosyalarına sağ tıklayarak Wine ile çalıştırabilirsiniz.');
          } else {
            openApp('terminal');
          }
        });
      });

      grid.querySelectorAll('.sw-install-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const cmd = btn.getAttribute('data-cmd');
          installLinuxPackage(cmd);
        });
      });

    } catch (err) {
      console.warn('Installed apps fetch failed:', err);
    }
  }

  async function launchLinuxGuiApp(appCmd) {
    try {
      openApp('vds');
      const res = await fetch('/api/vds/launch-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appCmd })
      });
      const data = await res.json();
      console.log('🚀 App launched:', data.message);
    } catch (err) {
      alert(`Uygulama Çalıştırma Hatası: ${err.message}`);
    }
  }

  async function installLinuxPackage(packageName) {
    openApp('software');
    switchToLogView();

    const term = document.getElementById('sw-install-log-terminal');
    if (term) term.textContent += `\n[ISTEK] "${packageName}" paketinin yüklenmesi başlatılıyor...\n`;

    try {
      const res = await fetch('/api/install-linux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName })
      });
      const data = await res.json();
      if (!data.success) {
        if (term) term.textContent += `⚠️ Hata: ${data.error}\n`;
      }
    } catch (err) {
      if (term) term.textContent += `⚠️ Bağlantı hatası: ${err.message}\n`;
    }
  }

  async function installDebPackage(debPath) {
    openApp('software');
    switchToLogView();

    const term = document.getElementById('sw-install-log-terminal');
    if (term) term.textContent += `\n[ISTEK] "${debPath}" .deb paketinin kurulumu dpkg ile başlatılıyor...\n`;

    try {
      const res = await fetch('/api/install-linux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debPath })
      });
      const data = await res.json();
      if (!data.success) {
        if (term) term.textContent += `⚠️ Hata: ${data.error}\n`;
      }
    } catch (err) {
      if (term) term.textContent += `⚠️ Bağlantı hatası: ${err.message}\n`;
    }
  }

  function switchToLogView() {
    const tabInstallerBtn = document.getElementById('sw-tab-installer');
    tabInstallerBtn?.click();
  }

  function setupSocketInstallListeners() {
    if (typeof socket === 'undefined' || !socket) return;

    socket.on('install-log', (data) => {
      const term = document.getElementById('sw-install-log-terminal');
      if (term && data && data.log) {
        term.textContent += data.log;
        term.scrollTop = term.scrollHeight;
      }
    });

    socket.on('install-complete', (data) => {
      const term = document.getElementById('sw-install-log-terminal');
      if (term && data) {
        term.textContent += `\n==========================================\n[TAMAMLANDI] ${data.message || ''}\n==========================================\n\n`;
        term.scrollTop = term.scrollHeight;
      }
      fetchInstalledApps();
    });
  }

  // ==========================================
  // 10. WALLPAPER SWITCHER
  // ==========================================
  document.querySelectorAll('.wallpaper-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      const theme = opt.getAttribute('data-theme');
      const desktop = document.getElementById('desktop');

      if (desktop) {
        desktop.className = `relative w-screen h-screen overflow-hidden bg-cover bg-center transition-all duration-700 wallpaper-${theme}`;
      }

      document.querySelectorAll('.wallpaper-opt').forEach(o => o.classList.replace('border-sky-500', 'border-transparent'));
      opt.classList.replace('border-transparent', 'border-sky-500');
    });
  });

  // Helpers
  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs}s ${mins}d ${secs}sn`;
  }
});
