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
      si.cpu(),
      si.mem(),
      si.fsSize()
    ]);

    const totalDiskBytes = fsSize.reduce((acc, drive) => acc + (drive.size || 0), 0);

    hardwareInfo = {
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim() || os.cpus()[0]?.model || 'Generic CPU',
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

  // Metrics collection ticker (every 1 second)
  setInterval(async () => {
    try {
      // Gather system metrics in parallel
      const [currentLoad, mem, fsSize, processes] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.processes()
      ]);

      // Calculate RAM values
      const ramTotalMB = (mem.total / (1024 * 1024)).toFixed(0);
      const ramUsedMB = (mem.used / (1024 * 1024)).toFixed(0);
      const ramFreeMB = (mem.free / (1024 * 1024)).toFixed(0);
      const ramPercent = ((mem.used / mem.total) * 100).toFixed(1);

      // Main disk calculation
      const primaryDisk = fsSize[0] || { size: 0, used: 0, use: 0, mount: '/' };
      const diskTotalGB = (primaryDisk.size / (1024 * 1024 * 1024)).toFixed(1);
      const diskUsedGB = (primaryDisk.used / (1024 * 1024 * 1024)).toFixed(1);
      const diskPercent = primaryDisk.use ? primaryDisk.use.toFixed(1) : 0;

      // Filter and format top 30 processes sorted by CPU usage
      const processList = (processes.list || [])
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 35)
        .map((proc) => ({
          pid: proc.pid,
          name: proc.name,
          cpu: proc.cpu ? proc.cpu.toFixed(1) : '0.0',
          memory: proc.mem ? proc.mem.toFixed(1) : '0.0',
          memRssMB: (proc.memRss / 1024).toFixed(1),
          user: proc.user || 'system',
          state: proc.state || 'running'
        }));

      const metricsData = {
        timestamp: Date.now(),
        hardware: hardwareInfo,
        cpu: {
          usagePercent: currentLoad.currentLoad.toFixed(1),
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
          mount: primaryDisk.mount || '/',
          totalGB: Number(diskTotalGB),
          usedGB: Number(diskUsedGB),
          usagePercent: Number(diskPercent)
        },
        processes: processList
      };

      // Broadcast real-time hardware metrics to all connected clients
      io.emit('system-metrics', metricsData);

    } catch (err) {
      console.error('⚠️ Sistem metrikleri toplama hatası:', err.message);
    }
  }, 1000);

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
        console.log(`💀 Process terminated via Task Manager: PID ${pid}`);
        socket.emit('kill-process-response', {
          success: true,
          pid,
          message: `PID ${pid} işlemi başarıyla sonlandırıldı.`
        });
      } catch (err) {
        console.error(`Failed to kill process PID ${pid}:`, err.message);
        socket.emit('kill-process-response', {
          success: false,
          pid,
          error: `İşlem sonlandırılamadı: ${err.message}`
        });
      }
    });
  });
}
