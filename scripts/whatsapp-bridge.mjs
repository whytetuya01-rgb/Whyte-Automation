/**
 * Standalone Local WhatsApp Automation Daemon for Whyte Quotation
 * Runs on http://127.0.0.1:5005
 *
 * Keeps a persistent WhatsApp Web session via LocalAuth (.wwebjs_auth/)
 * Allows sending quotations and PDFs automatically with 100% free lifetime zero-cost messaging.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth, MessageMedia } = pkg;
const PORT = process.env.PORT_WHATSAPP_BRIDGE || process.env.PORT || 5005;
const HOST = process.env.HOST_WHATSAPP_BRIDGE || "127.0.0.1";
const BRIDGE_SECRET = process.env.WHATSAPP_BRIDGE_SECRET?.trim() || "";

// Bounded in-memory idempotency deduplication cache
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 2 * 60 * 1000; // 2 minutes

function cleanIdempotencyCache() {
  const now = Date.now();
  for (const [key, item] of idempotencyCache.entries()) {
    if (now - item.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

function maskPhoneNumber(num) {
  if (!num) return "[unknown]";
  const s = String(num).replace(/\D/g, "");
  if (s.length <= 4) return "****";
  return `+${s.slice(0, 2)}****${s.slice(-4)}`;
}

function verifyBridgeAuth(req, url) {
  if (!BRIDGE_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.error("[WhatsApp Bridge] CRITICAL: WHATSAPP_BRIDGE_SECRET is unset in production. Refusing request.");
      return false;
    }
    return true;
  }

  const authHeader = req.headers["authorization"] || "";
  let token = "";

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf-8");
      // Format can be :secret or username:secret
      const parts = decoded.split(":");
      token = parts[1] || parts[0] || "";
    } catch {}
  }

  // Strictly forbid token in query parameters in production to prevent secret leakage in logs
  if (!token && url && url.searchParams.has("token")) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[WhatsApp Bridge] WARNING: Token in query parameter is forbidden in production (prevents log leakage). Use Authorization header.");
      return false;
    }
    token = url.searchParams.get("token") || "";
  }

  if (!token) return false;

  try {
    const expectedBuf = crypto.createHash("sha256").update(BRIDGE_SECRET).digest();
    const candidateBuf = crypto.createHash("sha256").update(token).digest();
    return crypto.timingSafeEqual(expectedBuf, candidateBuf);
  } catch {
    return false;
  }
}

/** Recursively removes stale Chromium lock files left over from abrupt terminations */
function clearStaleChromeLocks(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        clearStaleChromeLocks(fullPath);
      } else if (
        entry.name === "lockfile" ||
        entry.name === "SingletonLock" ||
        entry.name === "SingletonSocket" ||
        entry.name === "SingletonCookie" ||
        entry.name === "LOCK" ||
        entry.name === "DevToolsActivePort"
      ) {
        try {
          fs.unlinkSync(fullPath);
        } catch {}
      }
    }
  } catch {}
}

clearStaleChromeLocks("./.wwebjs_auth");

/** Auto-detects installed Google Chrome or Microsoft Edge on Windows/Mac/Linux */
function getBrowserExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

const browserPath = getBrowserExecutablePath();

let clientState = {
  status: "INITIALIZING", // INITIALIZING | WAITING_QR | AUTHENTICATED | CONNECTED | DISCONNECTED
  connected: false,
  qr: null,
  phoneNumber: null,
  pushname: null,
  lastError: null,
};

console.log("=================================================");
console.log("Starting Whyte WhatsApp Automation Bridge...");
if (browserPath) {
  console.log(`Using System Browser: ${browserPath}`);
}
console.log(`Web Dashboard: http://127.0.0.1:${PORT}/qr`);
console.log("=================================================");

let client = null;

function initWhatsAppClient() {
  clearStaleChromeLocks("./.wwebjs_auth");

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: "./.wwebjs_auth",
    }),
    puppeteer: {
      headless: true,
      ...(browserPath ? { executablePath: browserPath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", (qr) => {
    clientState.status = "WAITING_QR";
    clientState.connected = false;
    clientState.qr = qr;

    console.log("\n================================================================================");
    console.log("[WhatsApp Bridge] QR CODE IS READY!");
    console.log("👉 Open this link in your browser to scan with any WhatsApp number:");
    console.log(`   http://127.0.0.1:${PORT}/qr`);
    console.log("================================================================================\n");
  });

  client.on("authenticated", () => {
    clientState.status = "AUTHENTICATED";
    console.log("[WhatsApp Bridge] Authenticated successfully!");
  });

  client.on("auth_failure", (msg) => {
    clientState.status = "DISCONNECTED";
    clientState.connected = false;
    clientState.lastError = msg;
    console.error("[WhatsApp Bridge] Auth failure:", msg);
  });

  client.on("ready", () => {
    clientState.status = "CONNECTED";
    clientState.connected = true;
    clientState.qr = null;
    clientState.phoneNumber = client.info?.wid?.user || null;
    clientState.pushname = client.info?.pushname || null;
    console.log(`\n=================================================`);
    console.log(`[WhatsApp Bridge] READY & CONNECTED!`);
    console.log(`Sender Number: +${clientState.phoneNumber}`);
    console.log(`Sender Name:   ${clientState.pushname || "WhatsApp Business"}`);
    console.log(`Automated sending is active.`);
    console.log(`=================================================\n`);
  });

  client.on("disconnected", async (reason) => {
    clientState.status = "DISCONNECTED";
    clientState.connected = false;
    clientState.qr = null;
    console.log("[WhatsApp Bridge] Disconnected:", reason);
    try {
      await client.destroy().catch(() => {});
    } catch {}
    try {
      fs.rmSync("./.wwebjs_auth", { recursive: true, force: true });
    } catch {}
    clearStaleChromeLocks("./.wwebjs_auth");
    setTimeout(() => {
      console.log("[WhatsApp Bridge] Generating fresh QR code for new connection...");
      initWhatsAppClient();
    }, 2500);
  });

  client.initialize().catch((err) => {
    console.error("[WhatsApp Bridge] Initialization error:", err);
    clientState.lastError = err?.message || String(err);
  });
}

initWhatsAppClient();

// HTML page for scanning QR code in the browser
function renderQrHtmlPage() {
  const isConnected = clientState.connected;
  const qrUrl = clientState.qr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(clientState.qr)}`
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whyte WhatsApp Bridge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 24px; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; max-width: 440px; width: 100%; padding: 32px; text-align: center; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 100px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
    .badge.connected { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .badge.waiting { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
    .badge.init { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 8px; color: #0f172a; }
    p.sub { font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 24px; }
    .qr-container { background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 16px; padding: 16px; display: inline-flex; margin-bottom: 24px; }
    .qr-container img { width: 280px; height: 280px; border-radius: 8px; display: block; }
    .steps { text-align: left; background: #f8fafc; border-radius: 16px; padding: 18px 20px; margin-bottom: 20px; }
    .steps ol { padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.8; }
    .steps li { margin-bottom: 4px; }
    .footer { font-size: 11px; color: #94a3b8; }
  </style>
  <script>
    setInterval(async () => {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        if (data.status !== "${clientState.status}") {
          window.location.reload();
        }
      } catch (e) {}
    }, 2500);

    async function disconnectNumber() {
      if (!confirm("Are you sure you want to disconnect this phone number and link a different one?")) return;
      const btn = document.getElementById('btn-disconnect');
      if (btn) {
        btn.disabled = true;
        btn.innerText = "Disconnecting...";
      }
      try {
        await fetch('/logout', { method: 'POST' });
        setTimeout(() => { window.location.reload(); }, 2000);
      } catch (e) {
        alert("Failed to disconnect: " + e.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = "Switch / Disconnect This Number";
        }
      }
    }
  </script>
</head>
<body>
  <div class="card">
    ${
      isConnected
        ? `
      <div class="badge connected">
        <span>●</span> Connected & Active
      </div>
      <h1>WhatsApp Bridge Connected</h1>
      <p class="sub">Your business number is linked and ready to send quotations automatically.</p>
      <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
      <div class="steps" style="text-align: center;">
        <p style="font-size: 14px; font-weight: 700; color: #0f172a;">Active Sender Number</p>
        <p style="font-size: 18px; font-weight: 800; color: #059669; margin-top: 4px;">+${clientState.phoneNumber || "Connected"}</p>
        ${clientState.pushname ? `<p style="font-size: 13px; color: #64748b; margin-top: 2px;">${clientState.pushname}</p>` : ""}
      </div>
      <p class="footer" style="margin-bottom: 16px;">You can now click "Send via WhatsApp" on any quotation to deliver it automatically.</p>
      <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; margin-top: 18px;">
        <p style="font-size: 12px; color: #64748b; margin-bottom: 10px;">Want to change to a different number?</p>
        <button onclick="disconnectNumber()" id="btn-disconnect" style="background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 9px 18px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer;">
          Switch / Disconnect Phone Number
        </button>
      </div>
    `
        : qrUrl
        ? `
      <div class="badge waiting">
        <span>●</span> Waiting for Scan
      </div>
      <h1>Link WhatsApp</h1>
      <p class="sub">Scan this QR code with <strong>any phone number</strong> you want to send quotations from.</p>
      <div class="qr-container">
        <img src="${qrUrl}" alt="WhatsApp QR Code" />
      </div>
      <div class="steps">
        <ol>
          <li>Open <strong>WhatsApp</strong> on your phone</li>
          <li>Tap <strong>Settings</strong> or <strong>Menu (⋮)</strong></li>
          <li>Select <strong>Linked Devices</strong> > <strong>Link a Device</strong></li>
          <li>Scan the QR code above</li>
        </ol>
      </div>
      <p class="footer">Auto-refreshes every few seconds. 100% Free Lifetime Setup.</p>
    `
        : `
      <div class="badge init">
        <span>●</span> Initializing Browser...
      </div>
      <h1>Starting WhatsApp Client</h1>
      <p class="sub">Please wait 10-15 seconds while Chromium starts and generates your QR code...</p>
      <div style="padding: 40px; font-size: 13px; color: #64748b;">Loading QR Code...</div>
    `
    }
  </div>
</body>
</html>`;
}

// HTTP API Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  // GET /health - Lightweight unauthenticated container liveness probe (for Docker/K8s/Railway)
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache",
    });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // HTML QR Code Dashboard
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/qr")) {
    if (!verifyBridgeAuth(req, url)) {
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body style="font-family: sans-serif; text-align: center; padding: 60px 20px;">
        <h2 style="color: #0f172a;">401 Unauthorized</h2>
        <p style="color: #64748b;">Bridge authentication is active. Append <code>?token=&lt;WHATSAPP_BRIDGE_SECRET&gt;</code> to view the QR dashboard.</p>
      </body></html>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderQrHtmlPage());
    return;
  }

  // GET /status
  if (req.method === "GET" && url.pathname === "/status") {
    if (!verifyBridgeAuth(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized. Valid WHATSAPP_BRIDGE_SECRET bearer token required." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(clientState));
    return;
  }

  // POST /logout - Disconnects current number and regenerates fresh QR code for a new number
  if (req.method === "POST" && url.pathname === "/logout") {
    if (!verifyBridgeAuth(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized. Valid WHATSAPP_BRIDGE_SECRET bearer token required." }));
      return;
    }

    try {
      console.log("[WhatsApp Bridge] Logout requested. Resetting session...");
      if (client) {
        try {
          await client.logout();
        } catch (e) {
          console.warn("[WhatsApp Bridge] Client logout notice:", e?.message);
        }
        try {
          await client.destroy();
        } catch {}
      }
      try {
        fs.rmSync("./.wwebjs_auth", { recursive: true, force: true });
      } catch {}
      clearStaleChromeLocks("./.wwebjs_auth");

      clientState = {
        status: "INITIALIZING",
        connected: false,
        qr: null,
        phoneNumber: null,
        pushname: null,
        lastError: null,
      };

      setTimeout(() => {
        console.log("[WhatsApp Bridge] Starting clean client for new number linking...");
        initWhatsAppClient();
      }, 1500);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Logged out. Fresh QR code is generating." }));
    } catch (err) {
      console.error("[WhatsApp Bridge] Error during logout:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message || "Failed to logout" }));
    }
    return;
  }

  // POST /send
  if (req.method === "POST" && url.pathname === "/send") {
    if (!verifyBridgeAuth(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized. Valid WHATSAPP_BRIDGE_SECRET bearer token required." }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        if (!clientState.connected) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "WhatsApp client is not connected. Please scan QR code first at http://127.0.0.1:5005/qr",
              state: clientState,
            })
          );
          return;
        }

        const data = JSON.parse(body);
        const { to, message, pdfBase64, pdfFilename, idempotencyKey } = data;

        if (!to) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing 'to' phone number" }));
          return;
        }

        // Normalize phone number to WhatsApp chatId (e.g. 919898234336@c.us)
        const cleanNumber = String(to).replace(/\D/g, "");
        const formattedNumber = cleanNumber.length === 10 ? `91${cleanNumber}` : cleanNumber;
        const chatId = `${formattedNumber}@c.us`;

        // Check deduplication cache to prevent duplicate sends
        cleanIdempotencyCache();
        const dedupKey = idempotencyKey || `${formattedNumber}:${String(message || "").slice(0, 50)}`;
        if (idempotencyCache.has(dedupKey)) {
          const cached = idempotencyCache.get(dedupKey);
          console.log(`[WhatsApp Bridge] Duplicate send request for ${maskPhoneNumber(formattedNumber)}. Returning cached result.`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, messageId: cached.messageId, isDuplicate: true }));
          return;
        }

        console.log(`[WhatsApp Bridge] Sending quotation to ${maskPhoneNumber(formattedNumber)}...`);

        let sentMessage;
        if (pdfBase64) {
          const media = new MessageMedia(
            "application/pdf",
            pdfBase64,
            pdfFilename || "Quotation.pdf"
          );
          sentMessage = await client.sendMessage(chatId, media, {
            caption: message || "Please find your quotation attached.",
          });
        } else {
          sentMessage = await client.sendMessage(chatId, message);
        }

        const messageId = sentMessage.id?._serialized || `msg_${Date.now()}`;
        console.log(`[WhatsApp Bridge] Successfully delivered message ID: ${messageId}`);

        // Cache for deduplication
        idempotencyCache.set(dedupKey, { timestamp: Date.now(), messageId });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            messageId,
            recipient: maskPhoneNumber(formattedNumber),
          })
        );
      } catch (err) {
        console.error("[WhatsApp Bridge] Send error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Failed to send WhatsApp message",
          })
        );
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[WhatsApp Bridge] HTTP Server listening on http://${HOST}:${PORT}`);
  if (BRIDGE_SECRET) {
    console.log(`[WhatsApp Bridge] Bearer authentication is ACTIVE.`);
    console.log(`[WhatsApp Bridge] QR Dashboard URL: http://${HOST}:${PORT}/qr?token=${encodeURIComponent(BRIDGE_SECRET)}`);
  } else {
    console.warn(`[WhatsApp Bridge] WARNING: WHATSAPP_BRIDGE_SECRET is unset. Running in unauthenticated local dev mode.`);
    console.log(`[WhatsApp Bridge] QR Dashboard URL: http://${HOST}:${PORT}/qr`);
  }
});

function handleShutdown(signal) {
  console.log(`\n[WhatsApp Bridge] Received ${signal}. Shutting down cleanly...`);
  server.close(async () => {
    if (client) {
      try {
        await client.destroy();
      } catch {}
    }
    clearStaleChromeLocks("./.wwebjs_auth");
    process.exit(0);
  });
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
