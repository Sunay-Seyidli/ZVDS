#!/bin/bash
set -e

# Default environment variables
export PORT=${PORT:-10000}
export DISPLAY=${DISPLAY:-:99}
export ENV_PORT=${PORT}

# Clean up stale X display lock files if container restarted
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

echo "=========================================================="
echo "🚀 WebOS VDS Container Booting..."
echo "🖥️  Xvfb Display: $DISPLAY (1280x720x24)"
echo "🌐 Node.js Server Port: $PORT"
echo "🌐 noVNC / websockify Port: 6080 -> 5900"
echo "🍷 Wine Windows Executable Engine: Ready"
echo "🌐 Google Chrome Engine: Ready"
echo "=========================================================="

if [ -f /usr/bin/supervisord ]; then
    exec /usr/bin/supervisord -c /supervisord.conf
else
    echo "⚠️ Supervisor not found in environment, starting Node.js directly..."
    exec node server.js
fi
