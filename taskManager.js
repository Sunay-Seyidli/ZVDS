import si from 'systeminformation';
import os from 'os';

// Static hardware information cache
let hardwareInfo = {
  cpuModel: 'Yükleniyor...',
  cores: os.cpus().length,
  totalRamGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2),
  totalDiskGB: 0
};

// Initialize static hardware specs once
async function initHardwareInfo() {
  try {
    const [cpu, mem, fsSize] = await Promise.all([
      si.cpu().catch(() => ({ manufacturer: '', brand: '', cores: os.cpus().length })),
      si.mem().catch(() => ({ total: os.totalmem() })),
      si.fsSize().catch(() => [])
    ]);

    const totalDiskBytes = Array.isArray(fsSize) ? fsSize.reduce((acc, drive) => acc + (drive.size || 0), 0) : 0;

    hardwareInfo = {
      cpuModel: `${cpu.manufacturer || ''} ${cpu.brand || ''}`.trim() || os.cpus()[0]?.model || 'Cloud vCPU',
      cores: cpu.cores || os.cpus().length,
      totalRamGB: (mem.total / (1024 * 1024 * 1024)).toFixed(2),
      totalDiskGB: (totalDiskBytes / (1024 * 1024 * 1024)).toFixed(2)
    };
  } catch (err) {
    console.error('⚠️ Donanım bilgisi okuma hatası:', err.message);
  }
}

export function setupTaskManager(io) {
  // Read hardware info on startup
  initHardwareInfo();

  let tickCount = 0;
  let cachedProcesses = [];
  let cachedDisk = { size: 0, used: 0, use: 0, mount: '/' };

  // Optimized metrics collection (Runs every 3 seconds to keep Event Loop and Terminal ultra-responsive)
  setInterval(async () => {
    try {
      tickCount++;
      const promises = [
        si.currentLoad().catch(() => ({ currentLoad: 5 })),
        si.mem().catch(() => ({ total: os.totalmem(), used: os.totalmem() - os.freemem(), free: os.freemem() }))
      ];

      // Only fetch heavy processes and disk every 2nd cycle (every 6 seconds) to prevent CPU hogging
      if (tickCount % 2 === 1 || cachedProcesses.length === 0) {
        promises.push(si.processes().catch(() => ({ list: [] })));
        promises.push(si.fsSize().catch(() => []));
      }

      const results = await Promise.all(promises);
      const currentLoad = results[0];
      const mem = results[1];

      if (results[2]) {
        const procResult = results[2];
        cachedProcesses = (procResult.list || [])
          .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
          .slice(0, 20)
          .map((proc) => ({
            pid: proc.pid,
            name: proc.name,
            cpu: proc.cpu ? Number(proc.cpu).toFixed(1) : '0.0',
            memory: proc.mem ? Number(proc.mem).toFixed(1) : '0.0',
            memRssMB: (proc.memRss ? proc.memRss / 1024 : 0).toFixed(1),
            user: proc.user || 'system',
            state: proc.state || 'running'
          }));
      }

      if (results[3]) {
        const fsResult = results[3];
        cachedDisk = (Array.isArray(fsResult) && fsResult[0]) ? fsResult[0] : { size: 0, used: 0, use: 0, mount: '/' };
      }

      // Calculate RAM values
      const ramTotalMB = (mem.total / (1024 * 1024)).toFixed(0);
      const ramUsedMB = (mem.used / (1024 * 1024)).toFixed(0);
      const ramFreeMB = (mem.free / (1024 * 1024)).toFixed(0);
      const ramPercent = ((mem.used / mem.total) * 100).toFixed(1);

      // Main disk calculation
      const diskTotalGB = (cachedDisk.size / (1024 * 1024 * 1024)).toFixed(1);
      const diskUsedGB = (cachedDisk.used / (1024 * 1024 * 1024)).toFixed(1);
      const diskPercent = cachedDisk.use ? Number(cachedDisk.use).toFixed(1) : 0;

      const metricsData = {
        timestamp: Date.now(),
        hardware: hardwareInfo,
        cpu: {
          usagePercent: (currentLoad.currentLoad || 0).toFixed(1),
          cores: hardwareInfo.cores,
          model: hardwareInfo.cpuModel
        },
        memory: {
          totalMB: Number(ramTotalMB),
          usedMB: Number(ramUsedMB),
          freeMB: Number(ramFreeMB),
          usagePercent: Number(ramPercent)
        },
        disk: {
          mount: cachedDisk.mount || '/',
          totalGB: Number(diskTotalGB),
          usedGB: Number(diskUsedGB),
          usagePercent: Number(diskPercent)
        },
        processes: cachedProcesses
      };

      // Broadcast to clients
      io.emit('system-metrics', metricsData);

    } catch (err) {
      // Quiet fail to avoid polluting terminal logs
    }
  }, 3000);

  // Setup Socket.io event handlers for process management
  io.on('connection', (socket) => {
    // Process termination request handler
    socket.on('kill-process', (data) => {
      const pid = typeof data === 'object' ? data.pid : Number(data);
      if (!pid || isNaN(pid)) {
        socket.emit('kill-process-response', { success: false, error: 'Geçersiz PID' });
        return;
      }

      // Protect node server process itself from accidental termination
      if (pid === process.pid) {
        socket.emit('kill-process-response', { success: false, pid, error: 'WebOS ana sunucu işlemi kapatılamaz!' });
        return;
      }

      try {
        process.kill(pid, 'SIGKILL');
        socket.emit('kill-process-response', {
          success: true,
          pid,
          message: `PID ${pid} işlemi başarıyla sonlandırıldı.`
        });
      } catch (err) {
        socket.emit('kill-process-response', {
          success: false,
          pid,
          error: `İşlem sonlandırılamadı: ${err.message}`
        });
      }
    });
  });
}
