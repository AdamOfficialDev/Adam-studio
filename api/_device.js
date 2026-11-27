// Device Control Hub & Vision-Action Bridge (Memory + Optional Upstash Redis)
// Mendukung Desktop (Windows/macOS/Linux), Android (ADB Wireless/USB), dan Virtual Simulator.

const g = globalThis;
if (!g.__adamDeviceStore) {
  g.__adamDeviceStore = {
    pairCodes: new Map(), // code -> { platform, createdAt, expiresAt }
    devices: new Map(),   // deviceId -> DeviceInfo
    frames: new Map(),    // deviceId -> DeviceScreenFrame
    commands: new Map(),  // deviceId -> Array<CommandItem>
    results: new Map(),   // commandId -> { ok, output, error, frame, resolvedAt }
    approvals: new Map(), // approvalId -> { status: 'pending' | 'approved' | 'denied', resolvedAt }
  };
}

const mem = g.__adamDeviceStore;

function getRedisCredentials() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url, token };
}

async function redisCmd(args, timeoutMs = 1800) {
  const creds = getRedisCredentials();
  if (!creds) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(creds.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function kvSetJson(key, value, ttlSec = 600) {
  if (!getRedisCredentials()) return;
  await redisCmd(['SET', `adam:dev:${key}`, JSON.stringify(value), 'EX', ttlSec]);
}

async function kvGetJson(key) {
  if (!getRedisCredentials()) return null;
  const raw = await redisCmd(['GET', `adam:dev:${key}`]);
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvDel(key) {
  if (!getRedisCredentials()) return;
  await redisCmd(['DEL', `adam:dev:${key}`]);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function genCode(prefix = 'ADM') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export async function createPairingSession(platform = 'desktop') {
  const code = genCode('ADM');
  const now = Date.now();
  const entry = {
    code,
    platform: platform === 'android' ? 'android' : 'desktop',
    createdAt: now,
    expiresAt: now + 10 * 60_000,
  };
  mem.pairCodes.set(code, entry);
  await kvSetJson(`pair:${code}`, entry, 600);
  return entry;
}

async function updateDeviceIndex(deviceId, remove = false) {
  const idx = (await kvGetJson('index')) || [];
  const next = remove
    ? idx.filter((id) => id !== deviceId)
    : Array.from(new Set([deviceId, ...idx])).slice(0, 24);
  await kvSetJson('index', next, 3600);
}

export function isDeviceSharedStoreEnabled() {
  return Boolean(getRedisCredentials());
}

export async function registerDevice(payload = {}) {
  const now = Date.now();
  const pairCode = String(payload.pairCode || '').trim().toUpperCase();
  if (pairCode && !payload.isSimulator) {
    const localPair = mem.pairCodes.get(pairCode);
    const remotePair = localPair || (await kvGetJson(`pair:${pairCode}`));
    if (!remotePair || remotePair.expiresAt < now) {
      return { ok: false, message: `Pairing code "${pairCode}" tidak valid atau sudah kedaluwarsa.` };
    }
  }

  const id = String(payload.id || payload.deviceId || `dev-${now}-${Math.random().toString(36).slice(2, 7)}`).trim();
  const device = {
    id,
    name: String(payload.name || (payload.platform === 'android' ? 'Android Device' : 'Desktop PC')).slice(0, 64),
    platform: payload.platform === 'android' ? 'android' : 'desktop',
    os: String(payload.os || (payload.platform === 'android' ? 'Android ADB' : 'Desktop OS')).slice(0, 48),
    screenWidth: Math.max(240, Math.min(3840, Number(payload.screenWidth) || 1280)),
    screenHeight: Math.max(240, Math.min(3840, Number(payload.screenHeight) || 720)),
    status: 'online',
    isSimulator: Boolean(payload.isSimulator),
    connectedAt: mem.devices.get(id)?.connectedAt || now,
    lastSeenAt: now,
    lastAction: payload.lastAction ? String(payload.lastAction) : 'Terhubung',
  };

  mem.devices.set(id, device);
  await kvSetJson(`info:${id}`, device, 3600);
  await updateDeviceIndex(id, false);
  return { ok: true, device };
}

export async function getDevice(deviceId) {
  if (!deviceId) return null;
  let dev = mem.devices.get(deviceId) || (await kvGetJson(`info:${deviceId}`));
  if (!dev) return null;
  const age = Date.now() - (dev.lastSeenAt || 0);
  if (age > 90_000 && dev.status !== 'offline') {
    dev = { ...dev, status: 'offline' };
    mem.devices.set(deviceId, dev);
  }
  return dev;
}

export async function listDevices() {
  const now = Date.now();
  const map = new Map(mem.devices);
  const idx = await kvGetJson('index');
  if (Array.isArray(idx)) {
    for (const id of idx) {
      if (!map.has(id)) {
        const remote = await kvGetJson(`info:${id}`);
        if (remote) map.set(id, remote);
      }
    }
  }
  const out = [];
  for (const dev of map.values()) {
    const age = now - (dev.lastSeenAt || 0);
    const status = dev.status === 'paused' ? 'paused' : age > 90_000 ? 'offline' : dev.status || 'online';
    out.push({ ...dev, status });
  }
  return out.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
}

export async function removeDevice(deviceId) {
  mem.devices.delete(deviceId);
  mem.frames.delete(deviceId);
  mem.commands.delete(deviceId);
  await kvDel(`info:${deviceId}`);
  await kvDel(`frame:${deviceId}`);
  await kvDel(`queue:${deviceId}`);
  await updateDeviceIndex(deviceId, true);
  return { ok: true };
}

export async function setDevicePaused(deviceId, paused) {
  const dev = await getDevice(deviceId);
  if (!dev) return { ok: false, message: 'Device tidak ditemukan' };
  const updated = {
    ...dev,
    status: paused ? 'paused' : 'online',
    lastSeenAt: Date.now(),
    lastAction: paused ? 'Diambil alih manual oleh user' : 'Kontrol AI dilanjutkan',
  };
  mem.devices.set(deviceId, updated);
  await kvSetJson(`info:${deviceId}`, updated, 3600);
  return { ok: true, device: updated };
}

export async function pushDeviceFrame(deviceId, framePayload = {}) {
  const dev = await getDevice(deviceId);
  const now = Date.now();
  const frame = {
    deviceId,
    platform: framePayload.platform || dev?.platform || 'desktop',
    imageBase64: String(framePayload.imageBase64 || '').replace(/^data:[^;]+;base64,/, ''),
    mimeType: String(framePayload.mimeType || 'image/png'),
    width: Number(framePayload.width) || dev?.screenWidth || 1280,
    height: Number(framePayload.height) || dev?.screenHeight || 720,
    cursorX: typeof framePayload.cursorX === 'number' ? framePayload.cursorX : undefined,
    cursorY: typeof framePayload.cursorY === 'number' ? framePayload.cursorY : undefined,
    actionLabel: framePayload.actionLabel ? String(framePayload.actionLabel) : undefined,
    capturedAt: now,
  };
  if (dev) {
    const updatedDev = {
      ...dev,
      screenWidth: frame.width,
      screenHeight: frame.height,
      status: dev.status === 'paused' ? 'paused' : 'online',
      lastSeenAt: now,
      ...(frame.actionLabel ? { lastAction: frame.actionLabel } : {}),
    };
    mem.devices.set(deviceId, updatedDev);
    await kvSetJson(`info:${deviceId}`, updatedDev, 3600);
  }
  mem.frames.set(deviceId, frame);
  if (frame.imageBase64.length < 1_800_000) {
    await kvSetJson(`frame:${deviceId}`, frame, 600);
  }
  return { ok: true, frame };
}

export async function getDeviceFrame(deviceId) {
  return mem.frames.get(deviceId) || (await kvGetJson(`frame:${deviceId}`)) || null;
}

export async function pollBridgeCommands(deviceId, deviceHeartbeat = true) {
  if (deviceHeartbeat) {
    const dev = await getDevice(deviceId);
    if (dev) {
      const updated = {
        ...dev,
        status: dev.status === 'paused' ? 'paused' : 'online',
        lastSeenAt: Date.now(),
      };
      mem.devices.set(deviceId, updated);
      await kvSetJson(`info:${deviceId}`, updated, 3600);
    }
  }
  const localQ = mem.commands.get(deviceId) || [];
  if (localQ.length > 0) {
    mem.commands.set(deviceId, []);
    await kvDel(`queue:${deviceId}`);
    return localQ;
  }
  const remoteQ = await kvGetJson(`queue:${deviceId}`);
  if (Array.isArray(remoteQ) && remoteQ.length > 0) {
    await kvDel(`queue:${deviceId}`);
    return remoteQ;
  }
  return [];
}

export async function submitBridgeCommandResult({ commandId, deviceId, ok = true, output = '', error = '', frame = null }) {
  let savedFrame = null;
  if (frame && frame.imageBase64) {
    const res = await pushDeviceFrame(deviceId, frame);
    savedFrame = res.frame;
  }
  const resultObj = {
    commandId,
    deviceId,
    ok: Boolean(ok),
    output: String(output || ''),
    error: error ? String(error) : '',
    frame: savedFrame,
    resolvedAt: Date.now(),
  };
  mem.results.set(commandId, resultObj);
  await kvSetJson(`res:${commandId}`, resultObj, 120);
  return { ok: true, frame: savedFrame };
}

async function enqueueCommandAndWait({ deviceId, toolName, args, timeoutMs = 24_000, signal }) {
  const dev = await getDevice(deviceId);
  if (!dev) {
    return {
      ok: false,
      error: 'Device tidak terhubung. Silakan pilih atau hubungkan Desktop/Android di Panel Device.',
    };
  }
  if (dev.status === 'paused') {
    return {
      ok: false,
      error: 'Kontrol AI sedang dijeda (Take Over Manual aktif). Minta user klik "Lanjutkan AI" terlebih dahulu.',
    };
  }
  if (dev.status === 'offline') {
    return {
      ok: false,
      error: `Device "${dev.name}" sedang offline (>90 detik tidak ada heartbeat). Jalankan ulang adam-device-bridge.`,
    };
  }

  const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cmd = {
    commandId,
    deviceId,
    toolName,
    args: args || {},
    screenWidth: dev.screenWidth,
    screenHeight: dev.screenHeight,
    createdAt: Date.now(),
  };

  const q = mem.commands.get(deviceId) || [];
  q.push(cmd);
  mem.commands.set(deviceId, q);
  await kvSetJson(`queue:${deviceId}`, q, 60);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const localRes = mem.results.get(commandId);
    const res = localRes || (await kvGetJson(`res:${commandId}`));
    if (res) {
      mem.results.delete(commandId);
      return res;
    }
    await sleep(220, signal);
  }

  return {
    ok: false,
    error: `Timeout menunggu respons dari device "${dev.name}" (${Math.round(timeoutMs / 1000)}s). Pastikan bridge / simulator aktif.`,
  };
}

export function assessDeviceActionRisk(toolName, args = {}) {
  const text = String(args?.text || '');
  const combo = String(args?.combo || '').toLowerCase();
  const app = String(args?.appOrUrl || '').toLowerCase();
  const reason = String(args?.reason || '');

  if (toolName === 'device_screenshot' || toolName === 'device_wait' || toolName === 'device_scroll') {
    return {
      riskLevel: 'low',
      summary:
        toolName === 'device_screenshot'
          ? 'Mengambil tangkapan layar device'
          : toolName === 'device_wait'
            ? `Menunggu ${Number(args?.ms) || 800}ms`
            : `Scroll ${args?.direction || 'down'} di layar`,
    };
  }

  if (toolName === 'device_type') {
    const highRiskPattern =
      /\b(rm\s+-rf|sudo|curl\s+|wget\s+|bash|powershell|cmd\.exe|password|pin\b|otp\b|transfer|bayar|checkout|delete|hapus|format)\b/i;
    const isHigh = highRiskPattern.test(text) || highRiskPattern.test(reason);
    return {
      riskLevel: isHigh ? 'high' : 'medium',
      summary: `Mengetik teks: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"${args?.submit ? ' + Enter' : ''}`,
    };
  }

  if (toolName === 'device_key') {
    const isHigh = /(ctrl\+alt\+del|alt\+f4|cmd\+q|super\+l|win\+l)/i.test(combo);
    return {
      riskLevel: isHigh ? 'high' : 'medium',
      summary: `Menekan tombol: ${args?.combo || 'Return'}`,
    };
  }

  if (toolName === 'device_launch_app') {
    const isHigh = /(terminal|cmd|powershell|bash|zsh|regedit|settings|pengaturan)/i.test(app);
    return {
      riskLevel: isHigh ? 'high' : 'medium',
      summary: `Membuka aplikasi/URL: ${args?.appOrUrl || ''}`,
    };
  }

  if (toolName === 'device_swipe') {
    return {
      riskLevel: 'medium',
      summary: `Swipe layar (${args?.startX ?? 500},${args?.startY ?? 700}) → (${args?.endX ?? 500},${args?.endY ?? 250})`,
    };
  }

  // device_click_or_tap
  const highReason = /\b(kirim|send|bayar|pay|checkout|hapus|delete|install|izinkan|allow|confirm|konfirmasi|transfer|submit)\b/i.test(
    reason
  );
  return {
    riskLevel: highReason ? 'high' : 'medium',
    summary: `${args?.button === 'right' ? 'Klik kanan' : args?.button === 'double' ? 'Double klik' : 'Klik/Tap'} di (${args?.x ?? 500}, ${args?.y ?? 500})${reason ? ` — ${reason}` : ''}`,
  };
}

export function shouldRequireApproval(approvalMode, riskLevel) {
  if (riskLevel === 'low') return false;
  if (approvalMode === 'autonomous') return false;
  if (approvalMode === 'always') return riskLevel === 'medium' || riskLevel === 'high';
  return riskLevel === 'high';
}

export async function resolveDeviceApproval(approvalId, approved) {
  const entry = {
    approvalId,
    status: approved ? 'approved' : 'denied',
    resolvedAt: Date.now(),
  };
  mem.approvals.set(approvalId, entry);
  await kvSetJson(`apr:${approvalId}`, entry, 180);
  return { ok: true, ...entry };
}

async function requestApprovalAndWait({
  deviceId,
  toolName,
  riskLevel,
  summary,
  args,
  sendEvent,
  signal,
  timeoutMs = 90_000,
}) {
  const approvalId = `apr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const reqObj = {
    approvalId,
    deviceId,
    toolName,
    riskLevel,
    summary,
    args,
    createdAt: Date.now(),
  };
  mem.approvals.set(approvalId, { approvalId, status: 'pending' });
  await kvSetJson(`apr:${approvalId}`, { approvalId, status: 'pending' }, 180);

  sendEvent('device_approval', { approval: reqObj });
  sendEvent('status', { message: `Menunggu izin pengguna: ${summary}` });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const local = mem.approvals.get(approvalId);
    const remote = local?.status && local.status !== 'pending' ? local : await kvGetJson(`apr:${approvalId}`);
    if (remote && remote.status !== 'pending') {
      mem.approvals.delete(approvalId);
      return remote.status === 'approved';
    }
    await sleep(300, signal);
  }
  return false;
}

export const DEVICE_AGENT_SKILL = [
  '[ADAM STUDIO DEVICE CONTROLLER — VISION-ACTION LOOP]',
  'Kamu memiliki kemampuan mengendalikan device nyata (Desktop Windows/macOS/Linux atau HP Android) layaknya operator manusia.',
  'ATURAN WAJIB:',
  '1. SELALU mulai dengan memanggil `device_screenshot` terlebih dahulu agar kamu melihat kondisi layar saat ini sebelum mengklik atau mengetik.',
  '2. Gunakan koordinat ternormalisasi skala 0 sampai 1000 untuk sumbu X (kiri=0, kanan=1000) dan Y (atas=0, bawah=1000). Contoh: tengah layar adalah (500, 500).',
  '3. Lakukan aksi satu demi satu secara hati-hati. Setiap aksi mengembalikan screenshot terbaru; selalu periksa hasil visualnya sebelum langkah berikutnya.',
  '4. Selalu isi parameter `reason` dengan jelas dan jujur agar pengguna tahu apa yang akan kamu lakukan.',
  '5. Jika pengguna menolak izin (denied) atau menjeda kontrol (paused), JANGAN memaksa mengulang aksi yang ditolak. Tanyakan arahan pengguna dengan sopan.',
  '6. Jika suatu klik meleset setelah 2 kali percobaan, gunakan navigasi keyboard (`Tab`, `Enter`, `device_key`) atau coba koordinat alternatif.',
].join('\n');

export const DEVICE_TOOL_DECLARATIONS = [
  {
    name: 'device_screenshot',
    description: 'Mengambil screenshot layar Desktop atau HP Android saat ini untuk dianalisis secara visual.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Alasan mengambil screenshot' },
      },
    },
  },
  {
    name: 'device_click_or_tap',
    description: 'Mengklik (Desktop) atau Tap (Android) pada koordinat layar ternormalisasi 0..1000.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Koordinat horizontal 0..1000 (0=kiri, 1000=kanan)' },
        y: { type: 'NUMBER', description: 'Koordinat vertikal 0..1000 (0=atas, 1000=bawah)' },
        button: { type: 'STRING', description: 'left | right | double (default left)' },
        reason: { type: 'STRING', description: 'Elemen apa yang sedang diklik dan tujuannya' },
      },
      required: ['x', 'y', 'reason'],
    },
  },
  {
    name: 'device_swipe',
    description: 'Melakukan gesture swipe / drag dari koordinat awal ke koordinat akhir (0..1000), sangat berguna di HP Android atau drag di Desktop.',
    parameters: {
      type: 'OBJECT',
      properties: {
        startX: { type: 'NUMBER', description: 'Titik awal X (0..1000)' },
        startY: { type: 'NUMBER', description: 'Titik awal Y (0..1000)' },
        endX: { type: 'NUMBER', description: 'Titik akhir X (0..1000)' },
        endY: { type: 'NUMBER', description: 'Titik akhir Y (0..1000)' },
        durationMs: { type: 'NUMBER', description: 'Durasi swipe ms (default 320)' },
        reason: { type: 'STRING', description: 'Tujuan swipe' },
      },
      required: ['startX', 'startY', 'endX', 'endY', 'reason'],
    },
  },
  {
    name: 'device_type',
    description: 'Mengetikkan teks ke elemen atau kolom input yang sedang fokus di layar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Teks yang akan diketik' },
        submit: { type: 'BOOLEAN', description: 'Jika true, langsung menekan Enter/Search setelah mengetik' },
        reason: { type: 'STRING', description: 'Tujuan pengetikan teks ini' },
      },
      required: ['text', 'reason'],
    },
  },
  {
    name: 'device_key',
    description: 'Menekan tombol keyboard khusus atau kombinasi shortcut (contoh: "Return", "Escape", "Tab", "BackSpace", "ctrl+c", "ctrl+l", "alt+tab", "android_back", "android_home").',
    parameters: {
      type: 'OBJECT',
      properties: {
        combo: { type: 'STRING', description: 'Nama tombol atau kombinasi shortcut' },
        reason: { type: 'STRING', description: 'Tujuan menekan tombol' },
      },
      required: ['combo', 'reason'],
    },
  },
  {
    name: 'device_scroll',
    description: 'Melakukan scroll halaman ke atas atau bawah pada posisi tertentu.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', description: 'up | down' },
        amount: { type: 'NUMBER', description: 'Intensitas scroll 1..10 (default 4)' },
        x: { type: 'NUMBER', description: 'Koordinat X (0..1000, default 500)' },
        y: { type: 'NUMBER', description: 'Koordinat Y (0..1000, default 500)' },
        reason: { type: 'STRING', description: 'Alasan scroll' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'device_launch_app',
    description: 'Membuka aplikasi atau URL langsung di Desktop/Android (contoh: "https://google.com", "chrome", "notepad", "calc", "com.android.settings").',
    parameters: {
      type: 'OBJECT',
      properties: {
        appOrUrl: { type: 'STRING', description: 'Nama aplikasi, package name Android, atau URL http/https' },
        reason: { type: 'STRING', description: 'Alasan membuka aplikasi/URL' },
      },
      required: ['appOrUrl', 'reason'],
    },
  },
  {
    name: 'device_wait',
    description: 'Menunggu beberapa milidetik agar animasi atau loading halaman selesai lalu mengambil screenshot terbaru.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ms: { type: 'NUMBER', description: 'Durasi tunggu dalam ms (maks 5000)' },
        reason: { type: 'STRING', description: 'Apa yang sedang ditunggu' },
      },
    },
  },
];

export async function executeDeviceAgentTool({
  name,
  args = {},
  deviceId,
  approvalMode = 'high-risk',
  sendEvent,
  signal,
}) {
  if (!deviceId) {
    return {
      ok: false,
      summary: 'Belum ada device yang terhubung',
      response: {
        error: 'Belum ada device aktif. Minta pengguna membuka Panel Device di sebelah kanan untuk menghubungkan Desktop/Android atau menyalakan Virtual Test Device.',
      },
    };
  }

  const { riskLevel, summary } = assessDeviceActionRisk(name, args);
  if (shouldRequireApproval(approvalMode, riskLevel)) {
    const approved = await requestApprovalAndWait({
      deviceId,
      toolName: name,
      riskLevel,
      summary,
      args,
      sendEvent,
      signal,
    });
    if (!approved) {
      return {
        ok: false,
        summary: `Ditolak user: ${summary}`,
        response: {
          deniedByUser: true,
          error: `Pengguna menolak izin untuk aksi "${summary}". Hentikan aksi ini dan tanyakan instruksi selanjutnya kepada pengguna.`,
        },
      };
    }
  }

  if (name === 'device_wait') {
    const waitMs = Math.min(5000, Math.max(200, Number(args?.ms) || 1000));
    await sleep(waitMs, signal);
    const snap = await enqueueCommandAndWait({
      deviceId,
      toolName: 'device_screenshot',
      args: { reason: args?.reason || `Setelah menunggu ${waitMs}ms` },
      signal,
    });
    if (snap.frame) sendEvent('device_screen', { frame: snap.frame });
    return {
      ok: Boolean(snap.ok),
      summary: `Menunggu ${waitMs}ms`,
      frame: snap.frame || null,
      response: { ok: Boolean(snap.ok), waitedMs: waitMs, error: snap.error || undefined },
    };
  }

  const execRes = await enqueueCommandAndWait({
    deviceId,
    toolName: name,
    args,
    signal,
  });

  if (execRes.frame) {
    sendEvent('device_screen', { frame: execRes.frame });
  }

  return {
    ok: Boolean(execRes.ok),
    summary: execRes.ok ? summary : execRes.error || `Gagal: ${summary}`,
    frame: execRes.frame || null,
    response: {
      ok: Boolean(execRes.ok),
      action: name,
      output: execRes.output || undefined,
      error: execRes.error || undefined,
      screen: execRes.frame
        ? { width: execRes.frame.width, height: execRes.frame.height, platform: execRes.frame.platform }
        : undefined,
    },
  };
}
