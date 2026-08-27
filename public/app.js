// WebOS Core Operating System Script (Saf Vanilla JS - 60 FPS Performance)

document.addEventListener('DOMContentLoaded', () => {
  // Global System State
  let zIndexCount = 100;
  let activeAppId = null;
  let socket = window.io({ transports: ['websocket', 'polling'], upgrade: true }); // Global low-latency socket
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
    media: { title: 'Video & Medya Oynatıcı', icon: 'fa-circle-play', color: 'text-rose-400', el: document.getElementById('win-media') },
    settings: { title: 'Ayarlar', icon: 'fa-sliders', color: 'text-purple-400', el: document.getElementById('win-settings') }
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

  document.getElementById('ctx-file-media')?.addEventListener('click', () => {
    hideContextMenus();
    if (selectedFileItem && !selectedFileItem.isDirectory) {
      const ext = (selectedFileItem.extension || '').toLowerCase();
      openMediaSource(`/api/fs/stream?file=${encodeURIComponent(selectedFileItem.path)}`, selectedFileItem.name, ext);
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
      if (fitAddon) {
        try { fitAddon.fit(); } catch (e) {}
      }
      setTimeout(() => term.focus(), 30);
      return;
    }

    const container = document.getElementById('xterm-container');
    if (!container) return;

    term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Menlo, Monaco, "Courier New", Courier, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 2000,
      fastScrollModifier: 'alt',
      allowProposedApi: true,
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
    try { fitAddon.fit(); } catch (e) {}

    if (!socket) socket = window.io({ transports: ['websocket', 'polling'], upgrade: true });

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

    let resizeDebounce = null;
    window.addEventListener('resize', () => {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        if (fitAddon && !APPS.terminal.el.classList.contains('hidden')) {
          try { fitAddon.fit(); } catch (e) {}
        }
      }, 60);
    });

    document.getElementById('term-clear-btn')?.addEventListener('click', () => {
      term.clear();
      if (term) term.focus();
    });

    setTimeout(() => term.focus(), 80);
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
        const ext = (item.extension || '').toLowerCase();
        if (['.mp4', '.webm', '.mkv', '.avi', '.mov', '.ogv'].includes(ext)) iconClass = 'fa-file-video text-rose-400';
        else if (['.gif'].includes(ext)) iconClass = 'fa-file-image text-pink-400';
        else if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) iconClass = 'fa-file-image text-purple-400';
        else if (['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac'].includes(ext)) iconClass = 'fa-file-audio text-amber-400';
        else if (['.js', '.ts', '.jsx', '.tsx', '.json'].includes(ext)) iconClass = 'fa-file-code text-emerald-400';
        else if (['.html', '.css'].includes(ext)) iconClass = 'fa-file-lines text-sky-400';
        else if (ext === '.exe') iconClass = 'fa-brands fa-windows text-indigo-400';
        else if (ext === '.deb') iconClass = 'fa-box-archive text-teal-400';
        else if (ext === '.md' || ext === '.txt' || ext === '.log') iconClass = 'fa-file-lines text-slate-300';
      }

      card.innerHTML = `
        <i class="${iconClass.includes('fa-brands') ? iconClass : 'fa-solid ' + iconClass} text-3xl group-hover:scale-110 transition-transform"></i>
        <span class="text-xs font-medium text-slate-200 mt-2 truncate w-full" title="${item.name}">${item.name}</span>
        <span class="text-[10px] text-slate-500">${item.isDirectory ? 'Klasör' : formatBytes(item.size)}</span>
      `;

      // Double click to open
      card.addEventListener('dblclick', () => {
        const ext = (item.extension || '').toLowerCase();
        if (item.isDirectory) {
          loadDirectory(item.path);
        } else if (item.extension === '.exe') {
          launchWineExe(item.path);
        } else if (item.extension === '.deb') {
          installDebPackage(item.path);
        } else if (['.mp4', '.webm', '.mkv', '.avi', '.mov', '.ogv', '.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac'].includes(ext)) {
          openMediaSource(`/api/fs/stream?file=${encodeURIComponent(item.path)}`, item.name, ext);
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

      const ramVal = Number(data.memory.usagePercent) || 0;
      // Top bar memory icon tooltip
      const topMemIcon = document.getElementById('top-mem-icon');
      if (topMemIcon) topMemIcon.title = `Sistem Belleği: %${ramVal.toFixed(1)}`;

      // Only perform heavy Chart.js rendering & Process table DOM rebuilding if Task Manager is open
      const isMonitorVisible = APPS.monitor?.el && !APPS.monitor.el.classList.contains('hidden') && !APPS.monitor.el.classList.contains('minimized');
      if (!isMonitorVisible) {
        latestProcesses = data.processes || [];
        return;
      }

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
    if (!url || url.includes('browser-start.html')) return '/browser-start.html';

    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
      return url;
    }

    // If it looks like a domain name (e.g. google.com, youtube.com, github.com)
    if (url.includes('.') && !url.includes(' ')) {
      return 'https://' + url;
    }

    // Otherwise treat as a Google search query
    return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }

  async function initChromeVNC(initialUrl) {
    const container = document.getElementById('chrome-vnc-container');
    const statusEl = document.getElementById('chrome-vnc-status');
    const iframeEl = document.getElementById('chrome-iframe');
    const canvasEl = document.getElementById('chrome-vnc-canvas');
    const chromeUrlInput = document.getElementById('chrome-url-input');
    const modeTextEl = document.getElementById('chrome-mode-text');
    if (!container) return;

    const targetUrl = resolveTargetUrl(initialUrl || chromeUrlInput?.value || '/browser-start.html');

    if (chromeUrlInput) {
      chromeUrlInput.value = targetUrl === '/browser-start.html' ? '' : targetUrl;
    }

    if (canvasEl) canvasEl.classList.add('hidden');
    if (statusEl) statusEl.classList.add('hidden');

    if (iframeEl) {
      iframeEl.classList.remove('hidden');
      if (modeTextEl) modeTextEl.textContent = 'Web Modu';
      if (targetUrl === '/browser-start.html') {
        iframeEl.src = '/browser-start.html';
      } else {
        iframeEl.src = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      }
    }

    // Attempt starting background Chrome silently if in Docker environment
    fetch('/api/start-chrome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl === '/browser-start.html' ? 'https://www.google.com' : targetUrl })
    }).catch(() => {});
  }

  function navigateChrome(explicitUrl) {
    const chromeUrlInput = document.getElementById('chrome-url-input');
    const iframeEl = document.getElementById('chrome-iframe');
    const rawQuery = explicitUrl || chromeUrlInput?.value;
    const targetUrl = resolveTargetUrl(rawQuery);

    if (chromeUrlInput) {
      chromeUrlInput.value = targetUrl === '/browser-start.html' ? '' : targetUrl;
    }

    // Launch URL on container Chrome
    fetch('/api/start-chrome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl === '/browser-start.html' ? 'https://www.google.com' : targetUrl })
    }).catch(() => {});

    if (iframeEl && !iframeEl.classList.contains('hidden') && iframeEl.src.indexOf('/novnc/') === -1) {
      if (targetUrl === '/browser-start.html') {
        iframeEl.src = '/browser-start.html';
      } else {
        iframeEl.src = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      }
    } else {
      initChromeVNC(targetUrl);
    }
  }

  // Switch between VDS Desktop noVNC mode and Web Proxy mode
  document.getElementById('chrome-btn-switch-vds')?.addEventListener('click', () => {
    const iframeEl = document.getElementById('chrome-iframe');
    const chromeUrlInput = document.getElementById('chrome-url-input');
    const modeTextEl = document.getElementById('chrome-mode-text');
    const targetUrl = resolveTargetUrl(chromeUrlInput?.value || '/browser-start.html');

    if (!iframeEl) return;

    if (iframeEl.src.indexOf('/novnc/') !== -1) {
      // Switch to Web Proxy Mode
      iframeEl.src = targetUrl === '/browser-start.html' ? '/browser-start.html' : `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      if (modeTextEl) modeTextEl.textContent = 'Web Modu';
    } else {
      // Switch to VDS noVNC Live Desktop Mode
      iframeEl.src = `/novnc/vnc.html?autoconnect=true&resize=scale&quality=8&compression=2`;
      if (modeTextEl) modeTextEl.textContent = 'VDS Canlı Ekran';
      fetch('/api/start-chrome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl === '/browser-start.html' ? 'https://www.google.com' : targetUrl })
      }).catch(() => {});
    }
  });

  // Open in new tab (External browser)
  document.getElementById('chrome-btn-external')?.addEventListener('click', () => {
    const chromeUrlInput = document.getElementById('chrome-url-input');
    const targetUrl = resolveTargetUrl(chromeUrlInput?.value || 'https://www.google.com');
    const outUrl = targetUrl === '/browser-start.html' ? 'https://www.google.com' : targetUrl;
    window.open(outUrl, '_blank', 'noopener,noreferrer');
  });

  document.getElementById('chrome-btn-go')?.addEventListener('click', () => navigateChrome());
  document.getElementById('chrome-url-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateChrome();
  });

  document.getElementById('chrome-btn-home')?.addEventListener('click', () => {
    navigateChrome('/browser-start.html');
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

  // Listen for navigation events from proxied iframe
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'browser-url' && event.data.url) {
      const input = document.getElementById('chrome-url-input');
      if (input) {
        input.value = event.data.url;
      }
    }
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
  // 10. SOFTWARE CENTER & LIVE PACKAGE REGISTRY ENGINE (NPM / APT)
  // ==========================================
  let softwareCenterInitialized = false;
  let dynamicDesktopApps = [];

  function initSoftwareCenter() {
    if (!softwareCenterInitialized) {
      setupSoftwareCenterTabs();
      setupSoftwareCenterEvents();
      setupSocketInstallListeners();
      fetchDynamicDesktopApps();
      softwareCenterInitialized = true;
    }
    fetchInstalledApps();
  }

  function setupSoftwareCenterTabs() {
    const tabStoreBtn = document.getElementById('sw-tab-store');
    const tabSearchBtn = document.getElementById('sw-tab-search');
    const tabInstallerBtn = document.getElementById('sw-tab-installer');
    
    const viewStore = document.getElementById('sw-view-store');
    const viewSearch = document.getElementById('sw-view-search');
    const viewInstaller = document.getElementById('sw-view-installer');

    function resetTabs() {
      [tabStoreBtn, tabSearchBtn, tabInstallerBtn].forEach(btn => {
        btn?.classList.remove('bg-teal-600', 'text-white');
        btn?.classList.add('bg-slate-800', 'text-slate-300');
      });
      [viewStore, viewSearch, viewInstaller].forEach(view => {
        view?.classList.add('hidden');
      });
    }

    tabStoreBtn?.addEventListener('click', () => {
      resetTabs();
      tabStoreBtn.classList.add('bg-teal-600', 'text-white');
      tabStoreBtn.classList.remove('bg-slate-800', 'text-slate-300');
      viewStore?.classList.remove('hidden');
    });

    tabSearchBtn?.addEventListener('click', () => {
      resetTabs();
      tabSearchBtn.classList.add('bg-teal-600', 'text-white');
      tabSearchBtn.classList.remove('bg-slate-800', 'text-slate-300');
      viewSearch?.classList.remove('hidden');
      document.getElementById('sw-search-input')?.focus();
    });

    tabInstallerBtn?.addEventListener('click', () => {
      resetTabs();
      tabInstallerBtn.classList.add('bg-teal-600', 'text-white');
      tabInstallerBtn.classList.remove('bg-slate-800', 'text-slate-300');
      viewInstaller?.classList.remove('hidden');
    });
  }

  function setupSoftwareCenterEvents() {
    const searchInput = document.getElementById('sw-search-input');
    const searchBtn = document.getElementById('sw-search-btn');

    // Trigger online package search
    searchBtn?.addEventListener('click', () => {
      const q = searchInput?.value.trim();
      if (q) performOnlinePackageSearch(q);
    });

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput?.value.trim();
        if (q) performOnlinePackageSearch(q);
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
    document.getElementById('sw-refresh-apps-btn')?.addEventListener('click', () => {
      fetchInstalledApps();
      fetchDynamicDesktopApps();
    });

    // Clear Terminal Log
    document.getElementById('sw-clear-log-btn')?.addEventListener('click', () => {
      const term = document.getElementById('sw-install-log-terminal');
      if (term) term.textContent = 'Loglar temizlendi.\n';
    });
  }

  // Live search packages via server-side registry proxy
  async function performOnlinePackageSearch(query) {
    const searchTab = document.getElementById('sw-tab-search');
    const resultsGrid = document.getElementById('sw-search-results-grid');
    const statusText = document.getElementById('sw-search-status-text');

    // Switch to search tab automatically
    searchTab?.click();

    if (!resultsGrid) return;

    resultsGrid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center text-teal-400 space-y-3">
        <i class="fa-solid fa-circle-notch fa-spin text-3xl"></i>
        <p class="text-xs text-slate-300 font-mono">Gerçek API üzerinden "${query}" paketleri ve kararlı sürümler sorgulanıyor...</p>
      </div>
    `;

    if (statusText) statusText.textContent = 'Sorgulanıyor...';

    try {
      const res = await fetch(`/api/packages/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (!data.success || !data.results || data.results.length === 0) {
        resultsGrid.innerHTML = `
          <div class="col-span-full py-12 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
            <i class="fa-solid fa-triangle-exclamation text-3xl text-amber-500"></i>
            <p class="text-xs font-semibold text-slate-200">"${query}" için paket bulunamadı.</p>
            <p class="text-[11px] text-slate-500">Farklı bir paket veya kütüphane adı aramayı deneyin (örn: express, lodash, vlc, ffmpeg).</p>
          </div>
        `;
        if (statusText) statusText.textContent = '0 sonuç';
        return;
      }

      if (statusText) statusText.textContent = `${data.results.length} paket bulundu`;
      resultsGrid.innerHTML = '';

      data.results.forEach(pkg => {
        const card = document.createElement('div');
        card.className = 'bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between hover:border-teal-500/50 transition-all shadow-sm group';

        const isNpm = pkg.type === 'npm';
        const badgeColor = isNpm ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-sky-950 text-sky-300 border-sky-800';

        card.innerHTML = `
          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center">
                <i class="${pkg.icon || 'fa-solid fa-box'} text-lg ${pkg.color || 'text-teal-400'}"></i>
              </div>
              <div class="flex items-center space-x-1.5">
                <span class="text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border ${badgeColor}">
                  ${pkg.type} v${pkg.version}
                </span>
              </div>
            </div>

            <h4 class="text-xs font-bold text-slate-100 group-hover:text-teal-300 transition-colors flex items-center justify-between">
              <span class="truncate max-w-[170px]" title="${pkg.name}">${pkg.name}</span>
              ${pkg.score ? `<span class="text-[10px] text-slate-500 font-normal">⭐ ${pkg.score}%</span>` : ''}
            </h4>
            
            <p class="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight" title="${pkg.description}">
              ${pkg.description || 'Açıklama mevcut değil.'}
            </p>

            ${pkg.author ? `<p class="text-[10px] text-slate-500 mt-1 truncate">Geliştirici: ${pkg.author}</p>` : ''}
          </div>

          <div class="mt-3.5 pt-2 border-t border-slate-800/80 flex items-center space-x-2">
            <button class="pkg-install-btn flex-1 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 shadow" 
              data-name="${pkg.name}" 
              data-type="${pkg.type}" 
              data-version="${pkg.version}" 
              data-desc="${encodeURIComponent(pkg.description || '')}"
              data-icon="${pkg.icon || ''}"
              data-color="${pkg.color || ''}"
              data-cmd="${pkg.cmd || ''}">
              <i class="fa-solid fa-cloud-arrow-down text-xs"></i>
              <span>İndir & Masaüstüne Ekle</span>
            </button>
            ${pkg.homepage ? `
              <a href="${pkg.homepage}" target="_blank" rel="noopener noreferrer" class="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg text-xs transition-colors" title="Paket Resmi Sayfası">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
              </a>
            ` : ''}
          </div>
        `;

        resultsGrid.appendChild(card);
      });

      // Bind install buttons
      resultsGrid.querySelectorAll('.pkg-install-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-name');
          const type = btn.getAttribute('data-type');
          const version = btn.getAttribute('data-version');
          const desc = decodeURIComponent(btn.getAttribute('data-desc') || '');
          const icon = btn.getAttribute('data-icon');
          const color = btn.getAttribute('data-color');
          const cmd = btn.getAttribute('data-cmd');

          btn.disabled = true;
          btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-xs"></i><span>İndiriliyor...</span>`;

          await installRegistryPackage({ name, type, version, description: desc, icon, color, cmd });
          
          btn.disabled = false;
          btn.innerHTML = `<i class="fa-solid fa-check text-xs"></i><span>Yüklendi</span>`;
        });
      });

    } catch (err) {
      resultsGrid.innerHTML = `
        <div class="col-span-full py-12 flex flex-col items-center justify-center text-rose-400 text-center space-y-2">
          <i class="fa-solid fa-circle-xmark text-3xl"></i>
          <p class="text-xs font-semibold">Paket aranırken hata oluştu: ${err.message}</p>
        </div>
      `;
    }
  }

  // Install package via server API
  async function installRegistryPackage(pkgData) {
    openApp('software');
    switchToLogView();

    const term = document.getElementById('sw-install-log-terminal');
    if (term) {
      term.textContent += `\n[CANLI İNDİRME] "${pkgData.name} v${pkgData.version}" (${pkgData.type.toUpperCase()}) en kararlı sürümü indiriliyor...\n`;
    }

    try {
      const res = await fetch('/api/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pkgData)
      });
      const data = await res.json();
      if (!data.success && term) {
        term.textContent += `⚠️ Hata: ${data.error}\n`;
      }
    } catch (err) {
      if (term) term.textContent += `⚠️ Bağlantı hatası: ${err.message}\n`;
    }
  }

  // Fetch installed custom packages and append to Desktop & Start Menu
  async function fetchDynamicDesktopApps() {
    try {
      const res = await fetch('/api/packages/installed');
      const data = await res.json();
      if (data.success && Array.isArray(data.apps)) {
        dynamicDesktopApps = data.apps;
        renderDynamicDesktopIcons();
      }
    } catch (e) {
      console.warn('Failed to load dynamic desktop apps:', e);
    }
  }

  function renderDynamicDesktopIcons() {
    const desktopMain = document.getElementById('desktop');
    if (!desktopMain) return;

    // Remove existing dynamic icons
    desktopMain.querySelectorAll('.dynamic-desktop-icon').forEach(el => el.remove());

    dynamicDesktopApps.forEach(app => {
      const iconEl = document.createElement('div');
      iconEl.className = 'desktop-icon dynamic-desktop-icon pointer-events-auto group flex flex-col items-center cursor-pointer p-2 rounded-xl hover:bg-slate-800/40 transition-all duration-200';
      iconEl.setAttribute('data-app-name', app.name);

      iconEl.innerHTML = `
        <div class="w-14 h-14 bg-slate-900/90 backdrop-blur-md border border-teal-600/40 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-105 group-hover:border-teal-400 group-hover:shadow-teal-500/20 transition-all duration-200 relative">
          <i class="${app.icon || 'fa-solid fa-box'} text-2xl ${app.color || 'text-teal-400'}"></i>
          <span class="absolute -top-1 -right-1 w-3.5 h-3.5 bg-teal-500 rounded-full border-2 border-slate-900 flex items-center justify-center text-[8px] text-white">✓</span>
        </div>
        <span class="mt-2 text-xs text-center font-medium drop-shadow-md text-slate-200 group-hover:text-teal-300 truncate max-w-[80px]" title="${app.name}">
          ${app.name}
        </span>
      `;

      // Launch app when clicked
      iconEl.addEventListener('click', () => {
        openDynamicApp(app);
      });

      // Context menu to uninstall or info
      iconEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm(`"${app.name}" uygulamasını masaüstünden kaldırmak istiyor musunuz?`)) {
          uninstallDynamicApp(app.name);
        }
      });

      desktopMain.appendChild(iconEl);
    });
  }

  function openDynamicApp(app) {
    if (app.type === 'apt') {
      openApp('terminal');
      if (term) {
        term.write(`\r\n\x1b[36m[WebOS]\x1b[0m ${app.name} başlatılıyor...\r\n`);
        socket.emit('terminal-input', `${app.cmd || app.name}\n`);
      }
    } else {
      openApp('terminal');
      if (term) {
        term.write(`\r\n\x1b[32m[Node.js Library]\x1b[0m ${app.name} (${app.version}) yüklü kütüphane bilgisi:\r\n`);
        socket.emit('terminal-input', `npm list ${app.name}\n`);
      }
    }
  }

  async function uninstallDynamicApp(name) {
    try {
      const res = await fetch('/api/packages/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.success) {
        dynamicDesktopApps = dynamicDesktopApps.filter(a => a.name !== name);
        renderDynamicDesktopIcons();
      }
    } catch (e) {}
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

  // ==========================================
  // 11. VIDEO, GIF & MEDYA OYNATICI (MEDIA PLAYER ENGINE)
  // ==========================================
  const mediaVideoEl = document.getElementById('media-video-element');
  const mediaGifEl = document.getElementById('media-gif-element');
  const mediaVisualizerEl = document.getElementById('media-audio-visualizer');
  const mediaAudioTitleEl = document.getElementById('media-audio-title');
  const mediaEmptyEl = document.getElementById('media-empty-state');
  const mediaBigPlayBtn = document.getElementById('media-big-play-btn');
  const mediaPlayBtn = document.getElementById('media-btn-play');
  const mediaLoopBtn = document.getElementById('media-btn-loop');
  const mediaTimeline = document.getElementById('media-timeline-slider');
  const mediaCurrentTimeEl = document.getElementById('media-time-current');
  const mediaDurationEl = document.getElementById('media-time-duration');
  const mediaVolumeSlider = document.getElementById('media-volume-slider');
  const mediaMuteBtn = document.getElementById('media-btn-mute');
  const mediaVolumeIcon = document.getElementById('media-volume-icon');
  const mediaSpeedSelect = document.getElementById('media-speed-select');
  const mediaPipBtn = document.getElementById('media-btn-pip');
  const mediaFullscreenBtn = document.getElementById('media-btn-fullscreen');
  const mediaTypeBadge = document.getElementById('media-type-badge');
  const mediaFilenameEl = document.getElementById('media-filename');
  const mediaSampleSelect = document.getElementById('media-sample-selector');
  const mediaFileInput = document.getElementById('media-file-input');
  const mediaBtnOpenFile = document.getElementById('media-btn-open-file');
  const mediaBtnUrlStream = document.getElementById('media-btn-url-stream');
  const mediaDisplayContainer = document.getElementById('media-display-container');

  let isMediaLooping = true;
  let currentMediaType = 'none'; // 'video', 'gif', 'audio', 'image'
  let previousMediaVolume = 1.0;

  function formatMediaTime(sec) {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '00:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
    }
    return `${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }

  function openMediaSource(sourceUrl, displayName = 'Medya Dosyası', fileExtension = '') {
    if (!sourceUrl) return;

    openApp('media');

    const ext = (fileExtension || sourceUrl.split('?')[0].split('.').pop() || '').toLowerCase().replace('.', '');
    const isGif = ext === 'gif' || sourceUrl.includes('.gif') || sourceUrl.includes('giphy');
    const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext);
    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp'].includes(ext);

    if (mediaFilenameEl) {
      mediaFilenameEl.textContent = displayName || 'Medya Oynatılıyor';
    }

    if (isGif || isImage) {
      currentMediaType = isGif ? 'gif' : 'image';
      if (mediaVideoEl) {
        mediaVideoEl.pause();
        mediaVideoEl.classList.add('hidden');
      }
      if (mediaVisualizerEl) mediaVisualizerEl.classList.add('hidden');
      if (mediaEmptyEl) mediaEmptyEl.classList.add('hidden');
      if (mediaBigPlayBtn) mediaBigPlayBtn.classList.add('hidden');

      if (mediaGifEl) {
        mediaGifEl.src = sourceUrl;
        mediaGifEl.classList.remove('hidden');
      }

      if (mediaTypeBadge) {
        mediaTypeBadge.textContent = isGif ? 'GIF ANİMASYON' : 'RESİM';
        mediaTypeBadge.className = 'text-[10px] font-mono uppercase bg-pink-950/80 text-pink-300 border border-pink-800/60 px-2 py-0.5 rounded-full';
      }

      if (mediaPlayBtn) {
        mediaPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Görsel</span>';
        mediaPlayBtn.disabled = true;
      }
      if (mediaTimeline) {
        mediaTimeline.value = 100;
        mediaTimeline.disabled = true;
      }
      if (mediaCurrentTimeEl) mediaCurrentTimeEl.textContent = isGif ? 'Döngüde' : 'Statik';
      if (mediaDurationEl) mediaDurationEl.textContent = isGif ? 'GIF' : 'IMG';

    } else if (isAudio) {
      currentMediaType = 'audio';
      if (mediaGifEl) mediaGifEl.classList.add('hidden');
      if (mediaEmptyEl) mediaEmptyEl.classList.add('hidden');
      if (mediaBigPlayBtn) mediaBigPlayBtn.classList.add('hidden');

      if (mediaVisualizerEl) {
        mediaVisualizerEl.classList.remove('hidden');
        if (mediaAudioTitleEl) mediaAudioTitleEl.textContent = displayName;
      }

      if (mediaVideoEl) {
        mediaVideoEl.classList.add('hidden');
        mediaVideoEl.src = sourceUrl;
        mediaVideoEl.loop = isMediaLooping;
        mediaVideoEl.play().catch(e => console.log('Audio autoplay:', e));
      }

      if (mediaTypeBadge) {
        mediaTypeBadge.textContent = `SES / ${ext.toUpperCase() || 'AUDIO'}`;
        mediaTypeBadge.className = 'text-[10px] font-mono uppercase bg-amber-950/80 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full';
      }

      if (mediaPlayBtn) {
        mediaPlayBtn.disabled = false;
        mediaPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Duraklat</span>';
      }
      if (mediaTimeline) mediaTimeline.disabled = false;

    } else {
      // Default: Video Player (MP4, WebM, MKV, etc.)
      currentMediaType = 'video';
      if (mediaGifEl) mediaGifEl.classList.add('hidden');
      if (mediaVisualizerEl) mediaVisualizerEl.classList.add('hidden');
      if (mediaEmptyEl) mediaEmptyEl.classList.add('hidden');

      if (mediaVideoEl) {
        mediaVideoEl.classList.remove('hidden');
        mediaVideoEl.src = sourceUrl;
        mediaVideoEl.loop = isMediaLooping;
        mediaVideoEl.play().catch(e => {
          console.log('Video autoplay deferred:', e);
          if (mediaBigPlayBtn) mediaBigPlayBtn.classList.remove('hidden');
        });
      }

      if (mediaTypeBadge) {
        mediaTypeBadge.textContent = `VİDEO / ${ext.toUpperCase() || 'MP4'}`;
        mediaTypeBadge.className = 'text-[10px] font-mono uppercase bg-rose-950/80 text-rose-300 border border-rose-800/60 px-2 py-0.5 rounded-full';
      }

      if (mediaPlayBtn) {
        mediaPlayBtn.disabled = false;
        mediaPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Duraklat</span>';
      }
      if (mediaTimeline) mediaTimeline.disabled = false;
    }
  }

  // Video Element Playback Listeners
  if (mediaVideoEl) {
    mediaVideoEl.addEventListener('play', () => {
      if (mediaPlayBtn) {
        mediaPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Duraklat</span>';
      }
      if (mediaBigPlayBtn) mediaBigPlayBtn.classList.add('hidden');
    });

    mediaVideoEl.addEventListener('pause', () => {
      if (mediaPlayBtn) {
        mediaPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Oynat</span>';
      }
      if (currentMediaType === 'video' && mediaBigPlayBtn) {
        mediaBigPlayBtn.classList.remove('hidden');
      }
    });

    mediaVideoEl.addEventListener('timeupdate', () => {
      if (!mediaVideoEl.duration) return;
      const progress = (mediaVideoEl.currentTime / mediaVideoEl.duration) * 100;
      if (mediaTimeline && !mediaTimeline.matches(':active')) {
        mediaTimeline.value = isNaN(progress) ? 0 : progress;
      }
      if (mediaCurrentTimeEl) {
        mediaCurrentTimeEl.textContent = formatMediaTime(mediaVideoEl.currentTime);
      }
    });

    mediaVideoEl.addEventListener('loadedmetadata', () => {
      if (mediaDurationEl && mediaVideoEl.duration) {
        mediaDurationEl.textContent = formatMediaTime(mediaVideoEl.duration);
      }
      if (mediaCurrentTimeEl) {
        mediaCurrentTimeEl.textContent = formatMediaTime(mediaVideoEl.currentTime || 0);
      }
    });

    mediaVideoEl.addEventListener('ended', () => {
      if (!isMediaLooping) {
        if (mediaPlayBtn) mediaPlayBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Yeniden</span>';
        if (mediaBigPlayBtn && currentMediaType === 'video') mediaBigPlayBtn.classList.remove('hidden');
      }
    });

    mediaVideoEl.addEventListener('error', (e) => {
      console.error('Media playback error:', e);
      if (mediaTypeBadge) {
        mediaTypeBadge.textContent = 'OYNATMA HATASI';
        mediaTypeBadge.className = 'text-[10px] font-mono uppercase bg-red-950/80 text-red-300 border border-red-800/60 px-2 py-0.5 rounded-full';
      }
    });
  }

  // Play / Pause Toggle
  function toggleMediaPlay() {
    if (!mediaVideoEl || currentMediaType === 'gif' || currentMediaType === 'image') return;
    if (mediaVideoEl.paused || mediaVideoEl.ended) {
      mediaVideoEl.play().catch(e => console.log(e));
    } else {
      mediaVideoEl.pause();
    }
  }

  mediaPlayBtn?.addEventListener('click', toggleMediaPlay);
  mediaBigPlayBtn?.addEventListener('click', toggleMediaPlay);
  mediaVideoEl?.addEventListener('click', toggleMediaPlay);

  // Seek Slider
  mediaTimeline?.addEventListener('input', (e) => {
    if (mediaVideoEl && mediaVideoEl.duration) {
      const val = parseFloat(e.target.value);
      mediaVideoEl.currentTime = (val / 100) * mediaVideoEl.duration;
      if (mediaCurrentTimeEl) mediaCurrentTimeEl.textContent = formatMediaTime(mediaVideoEl.currentTime);
    }
  });

  // Rewind & Fast Forward (5 seconds)
  document.getElementById('media-btn-rewind')?.addEventListener('click', () => {
    if (mediaVideoEl) mediaVideoEl.currentTime = Math.max(0, mediaVideoEl.currentTime - 5);
  });

  document.getElementById('media-btn-forward')?.addEventListener('click', () => {
    if (mediaVideoEl && mediaVideoEl.duration) {
      mediaVideoEl.currentTime = Math.min(mediaVideoEl.duration, mediaVideoEl.currentTime + 5);
    }
  });

  // Loop Toggle
  mediaLoopBtn?.addEventListener('click', () => {
    isMediaLooping = !isMediaLooping;
    if (mediaVideoEl) mediaVideoEl.loop = isMediaLooping;
    if (isMediaLooping) {
      mediaLoopBtn.classList.replace('text-slate-400', 'text-sky-400');
      mediaLoopBtn.classList.replace('hover:text-white', 'text-sky-400');
      mediaLoopBtn.title = 'Döngü (Loop): Açık';
      mediaLoopBtn.innerHTML = '<i class="fa-solid fa-repeat text-sky-400"></i>';
    } else {
      mediaLoopBtn.classList.replace('text-sky-400', 'text-slate-400');
      mediaLoopBtn.title = 'Döngü (Loop): Kapalı';
      mediaLoopBtn.innerHTML = '<i class="fa-solid fa-repeat text-slate-400"></i>';
    }
  });

  // Playback Speed Selector
  mediaSpeedSelect?.addEventListener('change', (e) => {
    if (mediaVideoEl) {
      mediaVideoEl.playbackRate = parseFloat(e.target.value);
    }
  });

  // Volume & Mute Controls
  function updateVolumeIcon(vol, isMuted) {
    if (!mediaVolumeIcon) return;
    if (isMuted || vol === 0) {
      mediaVolumeIcon.className = 'fa-solid fa-volume-xmark text-rose-400 text-xs';
    } else if (vol < 0.5) {
      mediaVolumeIcon.className = 'fa-solid fa-volume-low text-slate-300 text-xs';
    } else {
      mediaVolumeIcon.className = 'fa-solid fa-volume-high text-slate-300 text-xs';
    }
  }

  mediaVolumeSlider?.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    if (mediaVideoEl) {
      mediaVideoEl.volume = vol;
      mediaVideoEl.muted = vol === 0;
    }
    updateVolumeIcon(vol, vol === 0);
  });

  mediaMuteBtn?.addEventListener('click', () => {
    if (!mediaVideoEl) return;
    if (mediaVideoEl.muted) {
      mediaVideoEl.muted = false;
      mediaVideoEl.volume = previousMediaVolume || 0.8;
      if (mediaVolumeSlider) mediaVolumeSlider.value = mediaVideoEl.volume;
      updateVolumeIcon(mediaVideoEl.volume, false);
    } else {
      previousMediaVolume = mediaVideoEl.volume || 0.8;
      mediaVideoEl.muted = true;
      if (mediaVolumeSlider) mediaVolumeSlider.value = 0;
      updateVolumeIcon(0, true);
    }
  });

  // Picture-in-Picture (PiP)
  mediaPipBtn?.addEventListener('click', async () => {
    if (!mediaVideoEl || currentMediaType !== 'video') return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await mediaVideoEl.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP not available:', e);
    }
  });

  // Fullscreen toggle
  mediaFullscreenBtn?.addEventListener('click', () => {
    const target = mediaDisplayContainer || APPS.media.el;
    if (!document.fullscreenElement) {
      target?.requestFullscreen?.().catch(e => console.warn(e));
    } else {
      document.exitFullscreen?.().catch(e => console.warn(e));
    }
  });

  // Local File Upload / Pick
  mediaBtnOpenFile?.addEventListener('click', () => mediaFileInput?.click());
  mediaFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const ext = '.' + file.name.split('.').pop();
      openMediaSource(url, file.name, ext);
      e.target.value = '';
    }
  });

  // Direct URL Streaming
  mediaBtnUrlStream?.addEventListener('click', () => {
    const url = prompt('Oynatmak istediğiniz Video veya GIF doğrudan URL adresini girin (MP4, WebM, GIF, MP3 vb.):');
    if (url && url.trim()) {
      const cleanUrl = url.trim();
      const name = cleanUrl.split('/').pop().split('?')[0] || 'Canlı Medya Akışı';
      openMediaSource(cleanUrl, name);
    }
  });

  // Preset Sample Media Selector
  mediaSampleSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    const opt = e.target.selectedOptions?.[0];
    const name = opt?.textContent || 'Örnek Medya';
    openMediaSource(val, name);
  });

  // Drag and Drop files directly onto Media Player Window
  const mediaWinEl = document.getElementById('win-media');
  if (mediaWinEl) {
    ['dragenter', 'dragover'].forEach(eventName => {
      mediaWinEl.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        mediaWinEl.classList.add('ring-2', 'ring-rose-500/80');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      mediaWinEl.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        mediaWinEl.classList.remove('ring-2', 'ring-rose-500/80');
      });
    });

    mediaWinEl.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const url = URL.createObjectURL(file);
        const ext = '.' + file.name.split('.').pop();
        openMediaSource(url, file.name, ext);
      }
    });
  }

  // Global Media Keyboard Shortcuts when Media Player is focused
  document.addEventListener('keydown', (e) => {
    if (activeAppId === 'media' && !APPS.media.el.classList.contains('hidden')) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggleMediaPlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (mediaVideoEl) mediaVideoEl.currentTime = Math.max(0, mediaVideoEl.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (mediaVideoEl && mediaVideoEl.duration) mediaVideoEl.currentTime = Math.min(mediaVideoEl.duration, mediaVideoEl.currentTime + 5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (mediaVideoEl) {
          mediaVideoEl.volume = Math.min(1, mediaVideoEl.volume + 0.1);
          if (mediaVolumeSlider) mediaVolumeSlider.value = mediaVideoEl.volume;
          updateVolumeIcon(mediaVideoEl.volume, false);
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (mediaVideoEl) {
          mediaVideoEl.volume = Math.max(0, mediaVideoEl.volume - 0.1);
          if (mediaVolumeSlider) mediaVolumeSlider.value = mediaVideoEl.volume;
          updateVolumeIcon(mediaVideoEl.volume, mediaVideoEl.volume === 0);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        mediaMuteBtn?.click();
      } else if (e.key === 'f' || e.key === 'F') {
        mediaFullscreenBtn?.click();
      } else if (e.key === 'l' || e.key === 'L') {
        mediaLoopBtn?.click();
      }
    }
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
