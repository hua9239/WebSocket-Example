const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const STATIC_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const reqPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    const safePath = path.normalize(reqPath).replace(/^([.][.][/\\])+/, '');
    const relativePath = safePath.replace(/^[/\\]+/, '');
    const filePath = path.resolve(STATIC_DIR, relativePath);

    if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found');
                return;
            }
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('500 Internal Server Error');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

let clientCount = 0;

wss.on('connection', (ws) => {
    clientCount++;
    const clientId = clientCount;
    ws.clientId = clientId;
    ws.isAlive = true;
    console.log(`[${new Date().toLocaleTimeString()}] Client ${clientId} connected. Total clients: ${wss.clients.size}`);

    ws.send(JSON.stringify({
        type: 'connected',
        clientId: clientId
    }));

    ws.on('pong', () => {
        ws.isAlive = true;
        if (ws.pingTimeout) {
            clearTimeout(ws.pingTimeout);
            ws.pingTimeout = null;
        }
        console.log(`[${new Date().toLocaleTimeString()}] Heartbeat OK: client ${clientId} -> pong`);
    });

    // 廣播客戶端數量更新
    broadcastClientCount();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`[${new Date().toLocaleTimeString()}] Client ${clientId} sent:`, data.content);

            // 廣播訊息給其他客戶端，不回送給自己
            broadcastMessage({
                type: 'broadcast',
                content: data.content,
                from: `Client ${clientId}`,
                timestamp: new Date().toLocaleTimeString()
            }, ws);
        } catch (e) {
            console.error('Message parse error:', e.message);
            ws.send(JSON.stringify({
                type: 'error',
                content: 'Invalid message format'
            }));
        }
    });

    ws.on('close', () => {
        if (ws.pingTimeout) {
            clearTimeout(ws.pingTimeout);
            ws.pingTimeout = null;
        }
        console.log(`[${new Date().toLocaleTimeString()}] Client ${clientId} disconnected. Total clients: ${wss.clients.size}`);
        broadcastClientCount();
    });

    ws.on('error', (error) => {
        console.error(`[${new Date().toLocaleTimeString()}] Client ${clientId} error:`, error.message);
    });
});

// 廣播訊息給所有連接客戶端，可排除指定連線
function broadcastMessage(message, excludedClient = null) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== excludedClient) {
            client.send(JSON.stringify(message));
        }
    });
}

// 广播客户端数量
function broadcastClientCount() {
    broadcastMessage({
        type: 'clientCount',
        count: wss.clients.size
    });
}

// 定時檢查連線健康狀態，無回應則主動斷線
const HEARTBEAT_INTERVAL_MS = 10000;
const PONG_TIMEOUT_MS = 5000;

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.warn(`[${new Date().toLocaleTimeString()}] Heartbeat FAIL: client ${ws.clientId} missed pong, terminate connection`);
            ws.terminate();
            return;
        }

        ws.isAlive = false;
        ws.ping();
        console.log(`[${new Date().toLocaleTimeString()}] Heartbeat: ping -> client ${ws.clientId}`);

        if (ws.pingTimeout) {
            clearTimeout(ws.pingTimeout);
        }

        ws.pingTimeout = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN && ws.isAlive === false) {
                console.warn(`[${new Date().toLocaleTimeString()}] Heartbeat TIMEOUT: client ${ws.clientId} no pong in ${PONG_TIMEOUT_MS}ms, terminate connection`);
                ws.terminate();
            }
        }, PONG_TIMEOUT_MS);
    });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
    console.log(`伺服器正在監聽 port ${PORT}`);
    console.log(`在瀏覽器中打開 http://localhost:${PORT} 開始聊天`);
});