import { ADAM_BRIDGE_SCRIPT } from './_bridgeScript.js';
import {
  createPairingSession,
  getDeviceFrame,
  isDeviceSharedStoreEnabled,
  listDevices,
  pollBridgeCommands,
  pushDeviceFrame,
  registerDevice,
  removeDevice,
  resolveDeviceApproval,
  setDevicePaused,
  submitBridgeCommandResult,
} from './_device.js';

export const config = {
  runtime: 'edge',
};

function jsonRes(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const action = url.searchParams.get('action') || 'list';
      const deviceId = url.searchParams.get('deviceId') || '';

      if (action === 'bridge-script') {
        return new Response(ADAM_BRIDGE_SCRIPT, {
          status: 200,
          headers: {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Content-Disposition': 'attachment; filename="adam-device-bridge.mjs"',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (action === 'list') {
        const devices = await listDevices();
        return jsonRes({ ok: true, devices, sharedStore: isDeviceSharedStoreEnabled() });
      }
      if (action === 'frame' && deviceId) {
        const frame = await getDeviceFrame(deviceId);
        return jsonRes({ ok: true, frame });
      }
      if (action === 'poll' && deviceId) {
        const commands = await pollBridgeCommands(deviceId, true);
        return jsonRes({ ok: true, commands });
      }
      return jsonRes({ ok: false, message: 'Parameter action GET tidak valid.' }, 400);
    }

    if (request.method !== 'POST') {
      return jsonRes({ ok: false, message: 'Method Not Allowed' }, 405);
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');

    if (action === 'create-pair') {
      const session = await createPairingSession(body?.platform || 'desktop');
      return jsonRes({ ok: true, ...session });
    }
    if (action === 'register') {
      const out = await registerDevice(body);
      return jsonRes(out, out.ok ? 200 : 400);
    }
    if (action === 'list') {
      const devices = await listDevices();
      return jsonRes({ ok: true, devices });
    }
    if (action === 'remove') {
      if (!body?.deviceId) return jsonRes({ ok: false, message: 'deviceId wajib diisi' }, 400);
      await removeDevice(String(body.deviceId));
      return jsonRes({ ok: true });
    }
    if (action === 'pause') {
      const out = await setDevicePaused(String(body?.deviceId || ''), Boolean(body?.paused));
      return jsonRes(out, out.ok ? 200 : 404);
    }
    if (action === 'push-frame') {
      if (!body?.deviceId) return jsonRes({ ok: false, message: 'deviceId wajib diisi' }, 400);
      const out = await pushDeviceFrame(String(body.deviceId), body.frame || body);
      return jsonRes(out);
    }
    if (action === 'poll-commands') {
      if (!body?.deviceId) return jsonRes({ ok: false, message: 'deviceId wajib diisi' }, 400);
      const commands = await pollBridgeCommands(String(body.deviceId), true);
      return jsonRes({ ok: true, commands });
    }
    if (action === 'submit-result') {
      if (!body?.commandId || !body?.deviceId) {
        return jsonRes({ ok: false, message: 'commandId & deviceId wajib diisi' }, 400);
      }
      const out = await submitBridgeCommandResult({
        commandId: String(body.commandId),
        deviceId: String(body.deviceId),
        ok: body.ok !== false,
        output: body.output || '',
        error: body.error || '',
        frame: body.frame || null,
      });
      return jsonRes(out);
    }
    if (action === 'resolve-approval') {
      if (!body?.approvalId) return jsonRes({ ok: false, message: 'approvalId wajib diisi' }, 400);
      const out = await resolveDeviceApproval(String(body.approvalId), Boolean(body.approved));
      return jsonRes(out);
    }

    return jsonRes({ ok: false, message: `Unknown device action: ${action}` }, 400);
  } catch (err) {
    return jsonRes(
      { ok: false, message: err instanceof Error ? err.message : 'Device hub error' },
      500
    );
  }
}
