# Whyte Quotation — WhatsApp Service Production Architecture

## 1. Architectural Overview & Serverless Hosting Realities

The core Whyte Quotation application is deployed on **Vercel** (`https://whyte-automation-sandy.vercel.app`), which executes frontend and backend code as **stateless serverless functions** (AWS Lambda microVMs).

### Why the WhatsApp Bridge Cannot Run Inside Vercel:
1. `whatsapp-web.js` drives a headless Google Chrome / Chromium browser via Puppeteer.
2. WhatsApp Web requires a continuous, stateful, persistent WebSocket connection to WhatsApp servers.
3. Serverless functions freeze and terminate between requests; they cannot host long-lived background daemons, cannot listen on incoming TCP ports (`127.0.0.1:5005`), and will destroy local disk session state when containers recycle.

---

## 2. Production Decoupled Architecture

To provide automated zero-cost WhatsApp quotation delivery in production, the architecture separates the system into two components:

```
┌──────────────────────────────────────────────┐
│ VERCEL SERVERLESS CLOUD                      │
│                                              │
│  Next.js 16 App Router & API Routes          │
│  (src/app/api/quotations/[id]/deliveries)    │
│                       │                      │
│       HTTP POST /send │ (with Bearer Token   │
│                       │  + 30s Timeout       │
│                       │  + Idempotency Key)  │
└───────────────────────┼──────────────────────┘
                        │
                        ▼ (HTTPS)
┌──────────────────────────────────────────────┐
│ PERSISTENT COMPANION HOST (Railway / VPS)    │
│                                              │
│  Docker Container (Dockerfile.whatsapp)      │
│  - Chromium + whatsapp-web.js                │
│  - Bearer Token Auth (timing-safe check)     │
│  - Persistent Volume (.wwebjs_auth/)         │
│  - Message Deduplication Cache               │
│                                              │
└───────────────────────┬──────────────────────┘
                        │
                        ▼
                 WhatsApp Web / Meta
```

### Fallback Guarantee:
If the WhatsApp bridge is offline, disconnected, or unconfigured, the application **automatically falls back to direct browser-based sharing** (`https://wa.me/<number>?text=...`). Legitimate salespeople can always dispatch quotations with a single click even if the bridge daemon is undergoing maintenance.

---

## 3. Security Hardening Measures Implemented

1. **Bearer Token Authentication**:
   - All sensitive bridge endpoints (`/send`, `/status`, `/logout`, `/qr`) require `Authorization: Bearer <WHATSAPP_BRIDGE_SECRET>`.
   - Token comparison uses `node:crypto`'s `crypto.timingSafeEqual` over SHA-256 hashes, preventing timing attacks.
   - In production (`NODE_ENV=production`), an unset secret automatically refuses requests.

2. **Idempotency & Deduplication**:
   - Both `src/lib/whatsappService.ts` and `scripts/whatsapp-bridge.mjs` maintain an idempotency cache.
   - If a salesperson double-clicks "Send" or a network retry occurs within 60-120 seconds, the bridge returns the previous `messageId` and marks `isDuplicate: true` without sending multiple messages to the client.

3. **Privacy & Masking**:
   - Phone numbers are masked in console output (e.g. `+91 98****3210`).
   - Customer phone numbers are never stored in plain serverless logs.

4. **Timeouts & Safe Error Handling**:
   - 3.5s timeout on status checks (`getWhatsAppBridgeStatus`).
   - 30s timeout on message dispatch with PDF (`sendViaWhatsAppBridge`).
   - Fail-closed security with detailed internal diagnostic logging.

---

## 4. How to Deploy the WhatsApp Bridge on Persistent Hosting

### Option A: Deploy on Railway (Recommended, zero-maintenance)
1. In your Railway dashboard, create a new project from this repository.
2. Set Dockerfile path to `Dockerfile.whatsapp`.
3. Add a persistent volume mounted at `/app/.wwebjs_auth`.
4. Configure Environment Variables in Railway:
   - `NODE_ENV=production`
   - `PORT_WHATSAPP_BRIDGE=5005`
   - `HOST_WHATSAPP_BRIDGE=0.0.0.0`
   - `WHATSAPP_BRIDGE_SECRET=<generate_a_random_64_character_hex_secret>`
5. Deploy and generate a Railway public domain (e.g. `https://whyte-whatsapp-production.up.railway.app`).
6. Update Vercel Environment Variables:
   - `WHATSAPP_BRIDGE_URL=https://whyte-whatsapp-production.up.railway.app`
   - `WHATSAPP_BRIDGE_SECRET=<same_secret>`
7. Open `https://whyte-whatsapp-production.up.railway.app/qr?token=<secret>` in your browser to scan the QR code and link your business phone.

### Option B: Deploy on Docker / VPS (DigitalOcean / AWS EC2)
1. Copy `Dockerfile.whatsapp` and `docker-compose.whatsapp.yml` to your VPS.
2. Run:
   ```bash
   WHATSAPP_BRIDGE_SECRET=your_secure_secret docker-compose -f docker-compose.whatsapp.yml up -d
   ```
3. Setup Nginx with SSL reverse proxy pointing to `localhost:5005`.
4. Update `WHATSAPP_BRIDGE_URL` and `WHATSAPP_BRIDGE_SECRET` in your Vercel project settings.

