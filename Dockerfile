# Multi-stage production Dockerfile for WebOS Cloud System VDS Container
# Features: XFCE Desktop, noVNC / websockify HTML5 streaming, Google Chrome, Wine (.exe), Node.js 20

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV RESOLUTION=1280x720x24
ENV PORT=3000
ENV NODE_ENV=production

# 1. Base System Packages & Build Tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    wget \
    software-properties-common \
    ca-certificates \
    git \
    bash \
    procps \
    htop \
    supervisor \
    xvfb \
    x11vnc \
    xfce4 \
    xfce4-terminal \
    novnc \
    websockify \
    dbus-x11 \
    python3 \
    make \
    g++ \
    gcc \
    sudo \
    dpkg \
    apt-utils \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 3. Install Official Google Chrome Stable
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# 4. Install Wine (.exe Windows Application Compatibility Layer)
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       wine \
       wine32 \
       wine64 \
       winetricks \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package descriptors & install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy WebOS application code & assets
COPY . .

# Setup entrypoint and supervisor config
COPY supervisord.conf /supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose WebOS port
EXPOSE 3000 10000

# Start VDS Container via Entrypoint
CMD ["/entrypoint.sh"]
