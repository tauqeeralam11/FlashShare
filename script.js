const CHUNK_SIZE = 256 * 1024;
const BUFFER_LIMIT = 8 * 1024 * 1024;

const PEER_OPT = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    debug: 0
};

lucide.createIcons();
const myId = Math.floor(1000 + Math.random() * 9000).toString();
document.getElementById('my-id').innerText = myId;

let peer, conn;
let queue = [];
let isActive = false;
let currTask = null;
let pingTimer;

function init() {
    peer = new Peer(myId, PEER_OPT);

    peer.on('open', id => console.log('System Ready:', id));
    peer.on('connection', c => handleConn(c));
    peer.on('error', e => {
        showToast("Network Error: " + e.type, 'err');
        resetBtn();
    });

    window.addEventListener('beforeunload', () => {
        if (conn && conn.open) conn.send({ type: 'bye' });
    });
}
init();

function connect() {
    const pid = document.getElementById('p-id').value.trim();
    if (pid.length !== 4) return showToast("Invalid ID Format", 'err');

    const btn = document.getElementById('btn-conn');
    btn.innerHTML = `<span class="spin inline-block mr-2">⏳</span> Connecting...`;

    const c = peer.connect(pid, { reliable: true });
    handleConn(c);
}

function handleConn(c) {
    conn = c;

    conn.on('open', () => {
        showScreen('v-dash');
        showToast("Link Established Successfully");
        startHeartbeat();
        analyzeNetwork();
    });

    conn.on('data', d => {
        if (d instanceof ArrayBuffer || d instanceof Uint8Array) handleBinary(d);
        else handleMsg(d);
    });

    conn.on('close', onDisconnect);
    conn.on('error', onDisconnect);
}

function onDisconnect() {
    showToast("Session Terminated", 'err');
    clearInterval(pingTimer);
    setTimeout(() => location.reload(), 2000);
}

function endSession() {
    if (conn) conn.send({ type: 'bye' });
    onDisconnect();
}

function analyzeNetwork() {
    setTimeout(() => {
        if (!conn || !peer.connections[conn.peer]) return;

        const pc = peer.connections[conn.peer][0].peerConnection;
        const state = pc.iceConnectionState;
        const elStat = document.getElementById('net-stat');
        const elDot = document.getElementById('net-dot');

        if (state === 'connected' || state === 'completed') {
            elStat.innerText = "Direct Link (Optimized)";
            elStat.classList.add('text-emerald-400');
            elDot.classList.replace('bg-slate-600', 'bg-emerald-500');
            elDot.classList.add('animate-pulse');
        } else {
            elStat.innerText = "Relayed (Check Network)";
            elStat.classList.add('text-amber-400');
            elDot.classList.replace('bg-slate-600', 'bg-amber-500');
        }
    }, 1000);
}

function startHeartbeat() {
    pingTimer = setInterval(() => {
        if (conn && conn.open) conn.send({ type: 'ping' });
    }, 3000);
}

function handleFiles(input) {
    const files = Array.from(input.files);
    if (!files.length) return;
    document.getElementById('empty').classList.add('hidden');

    files.forEach(f => {
        const id = Math.random().toString(36).substr(2, 6);
        createRow(id, f.name, f.size, 'up');
        queue.push({ id, file: f, type: 'up', name: f.name, size: f.size, status: 'wait' });
    });
    input.value = '';
    updateQCount();
    runQueue();
}

async function runQueue() {
    if (isActive || queue.length === 0) return;

    const task = queue.find(t => t.status === 'wait');
    if (!task) return;

    isActive = true;
    currTask = task;
    task.status = 'active';

    updateRowUI(task.id, 'active');

    try {
        if (task.type === 'up') await uploadFile(task);
    } catch (e) {
        console.error(e);
        if (task.status !== 'cancelled') updateRowUI(task.id, 'error');
    }

    isActive = false;
    currTask = null;
    document.getElementById('spd').innerHTML = `0.0 <span class="text-sm text-slate-600">MB/s</span>`;

    runQueue();
}

async function uploadFile(task) {
    return new Promise((resolve) => {
        conn.send({ type: 'header', id: task.id, name: task.name, size: task.size });

        const reader = new FileReader();
        let offset = 0;
        let lastTime = Date.now();
        let bytesSince = 0;

        task.cancel = () => {
            reader.abort();
            conn.send({ type: 'cancel', id: task.id });
            task.status = 'cancelled';
            updateRowUI(task.id, 'cancelled');
            resolve();
        };

        const readNext = () => {
            if (task.status === 'cancelled') return;
            const slice = task.file.slice(offset, offset + CHUNK_SIZE);
            reader.readAsArrayBuffer(slice);
        };

        reader.onload = async (e) => {
            if (task.status === 'cancelled') return;

            while (conn.dataChannel.bufferedAmount > BUFFER_LIMIT) {
                await new Promise(r => setTimeout(r, 5));
            }

            conn.send(e.target.result);
            offset += e.target.result.byteLength;
            bytesSince += e.target.result.byteLength;

            const now = Date.now();
            if (now - lastTime > 500) {
                const mbps = (bytesSince / 1024 / 1024) / ((now - lastTime) / 1000);
                document.getElementById('spd').innerHTML = `${mbps.toFixed(1)} <span class="text-sm text-slate-600">MB/s</span>`;
                updateProgress(task.id, offset, task.size);
                lastTime = now;
                bytesSince = 0;
            }

            if (offset < task.size) {
                readNext();
            } else {
                conn.send({ type: 'end', id: task.id });
                task.status = 'done';
                updateRowUI(task.id, 'done');
                resolve();
            }
        };
        readNext();
    });
}

async function handleMsg(msg) {
    if (msg.type === 'bye') onDisconnect();
    if (msg.type === 'ping') return;

    if (msg.type === 'header') {
        document.getElementById('empty').classList.add('hidden');
        createRow(msg.id, msg.name, msg.size, 'down');

        const task = {
            id: msg.id, type: 'down', name: msg.name, size: msg.size,
            status: 'active', received: 0, lastTime: Date.now(), bytesSince: 0
        };

        const fs = streamSaver.createWriteStream(msg.name, { size: msg.size });
        task.writer = fs.getWriter();

        task.cancel = () => {
            task.writer.abort();
            conn.send({ type: 'cancel', id: task.id });
            task.status = 'cancelled';
            updateRowUI(task.id, 'cancelled');
            cleanupRx();
        };

        currTask = task;
        isActive = true;
        updateRowUI(msg.id, 'active');
    }

    else if (msg.type === 'end') {
        if (currTask && currTask.id === msg.id) {
            currTask.writer.close();
            updateRowUI(msg.id, 'done');
            cleanupRx();
        }
    }

    else if (msg.type === 'cancel') {
        if (currTask && currTask.id === msg.id) {
            if (currTask.type === 'up') currTask.status = 'cancelled';
            else currTask.writer.abort();

            updateRowUI(msg.id, 'cancelled');

            if (currTask.type === 'down') cleanupRx();
            else setTimeout(runQueue, 500);
        }
    }
}

function handleBinary(data) {
    if (!currTask || currTask.type !== 'down' || currTask.status !== 'active') return;

    const arr = new Uint8Array(data);
    currTask.writer.write(arr);
    currTask.received += arr.length;
    currTask.bytesSince += arr.length;

    const now = Date.now();
    if (now - currTask.lastTime > 500) {
        const mbps = (currTask.bytesSince / 1024 / 1024) / ((now - currTask.lastTime) / 1000);
        document.getElementById('spd').innerHTML = `${mbps.toFixed(1)} <span class="text-sm text-slate-600">MB/s</span>`;
        updateProgress(currTask.id, currTask.received, currTask.size);
        currTask.lastTime = now;
        currTask.bytesSince = 0;
    }
}

function cleanupRx() {
    isActive = false;
    currTask = null;
    document.getElementById('spd').innerHTML = `0.0 <span class="text-sm text-slate-600">MB/s</span>`;
}

function createRow(id, name, size, type) {
    const tpl = document.getElementById('tpl-row').content.cloneNode(true);
    const el = tpl.querySelector('div');
    el.id = `r-${id}`;
    el.querySelector('.f-name').innerText = name;

    const icon = el.querySelector('.icon-svg');
    const box = el.querySelector('.icon-box');

    if (type === 'up') {
        icon.classList.add('text-blue-400');
        box.classList.add('border-blue-500/30', 'bg-blue-500/10');
    } else {
        icon.classList.add('text-emerald-400');
        box.classList.add('border-emerald-500/30', 'bg-emerald-500/10');
    }

    el.querySelector('.btn-cancel').onclick = () => {
        if (currTask && currTask.id === id) currTask.cancel();
        else {
            const idx = queue.findIndex(t => t.id === id);
            if (idx > -1) { queue.splice(idx, 1); el.remove(); updateQCount(); }
        }
    };
    document.getElementById('f-list').appendChild(el);
    lucide.createIcons();
}

function updateProgress(id, curr, total) {
    const el = document.getElementById(`r-${id}`);
    if (el) {
        const p = Math.floor((curr / total) * 100);
        el.querySelector('.progress-bar').style.width = `${p}%`;
        el.querySelector('.f-pct').innerText = `${p}%`;
    }
}

function updateRowUI(id, stat) {
    const el = document.getElementById(`r-${id}`);
    if (!el) return;

    if (stat === 'active') {
        el.classList.add('border-blue-500', 'bg-blue-500/5');
    } else if (stat === 'done') {
        el.querySelector('.progress-bar').classList.replace('bg-blue-500', 'bg-emerald-500');
        el.querySelector('.f-pct').classList.add('text-emerald-500');
        el.querySelector('.btn-cancel').remove();
        el.classList.add('opacity-50');
    } else if (stat === 'cancelled') {
        el.querySelector('.progress-bar').classList.replace('bg-blue-500', 'bg-red-500');
        el.querySelector('.f-name').classList.add('line-through', 'text-red-400');
        el.querySelector('.btn-cancel').remove();
        el.classList.add('opacity-50');
    }
}

function updateQCount() {
    document.getElementById('q-count').innerText = queue.length;
}

function showScreen(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden-view'));
    document.getElementById(id).classList.remove('hidden-view');
}

function showToast(msg, type = 'norm') {
    const t = document.createElement('div');
    t.className = `toast ${type === 'err' ? 'text-red-400' : 'text-emerald-400'}`;
    t.innerHTML = `<i data-lucide="${type === 'err' ? 'alert-circle' : 'check-circle'}" class="w-4 h-4"></i> ${msg}`;
    document.getElementById('toast-area').appendChild(t);
    lucide.createIcons();
    setTimeout(() => t.remove(), 3000);
}

function copyId() {
    navigator.clipboard.writeText(myId);
    showToast("ID Copied");
}

function resetBtn() {
    document.getElementById('btn-conn').innerHTML = `<span>Establish Secure Link</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
    lucide.createIcons();
}
