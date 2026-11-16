# Whyte Quotation — Production Operations Runbook & Deployment Guide

> **Authoritative Operational Reference for Whyte Quotation Platform**  
> Covers Next.js 16 deployment on Vercel, MongoDB Atlas disaster recovery, Docker-based WhatsApp bridge hosting, incident triage, and maintenance procedures.

---

## 1. Production Architecture Overview

The system operates across three decoupled tiers:

```
┌──────────────────────────────────────────────┐
│ VERCEL SERVERLESS EDGE & APP TIER            │
│ - Next.js 16 App Router (Node.js 20 runtime) │
│ - Content Security Policy & Security Headers │
│ - NextAuth.js JWT-based session security     │
│ - Client-side PDF generation (jspdf)         │
│ - Synthetic Liveness Endpoint (/health/live) │
└───────────────────────┬──────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│ MONGODB ATLAS TIER   │      │ WHATSAPP BRIDGE COMPANION    │
│ - Multi-tenant DB    │      │ - Persistent Docker container│
│ - M10+ Recommended   │      │ - Chromium + wwebjs session  │
│ - Automated Backups  │      │ - Bearer Token Auth          │
│ - Unique Indexes     │      │ - Message Deduplication      │
└──────────────────────┘      └──────────────────────────────┘
```

---

## 2. Production Deployment Guide (Vercel)

### Step 1: Connect Git Repository
1. Import the repository in the Vercel Dashboard.
2. Select **Next.js** framework preset.
3. Root Directory: `./` (leave default).

### Step 2: Build & Output Settings
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm ci`
- **Node.js Version**: `20.x`

### Step 3: Configure Environment Variables
Set the following mandatory environment variables in **Settings > Environment Variables**:

| Variable Name | Environment | Value Description |
|---|---|---|
| `MONGODB_URI` | Production | MongoDB Atlas replica set URI (`mongodb+srv://...`) |
| `NEXTAUTH_SECRET` | Production | Cryptographically random 32+ character string |
| `NEXTAUTH_URL` | Production | Canonical public URL (e.g. `https://quote.whyteautomation.com`) |
| `CLOUDINARY_CLOUD_NAME` | Production | Cloudinary cloud identifier |
| `CLOUDINARY_API_KEY` | Production | Cloudinary access key |
| `CLOUDINARY_API_SECRET` | Production | Cloudinary API secret |
| `RESEND_API_KEY` | Production | Resend transactional mail key |
| `EMAIL_FROM` | Production | Verified sending address (`WHYTE <no-reply@whyte.co.in>`) |
| `CRON_SECRET` | Production | Vercel Cron authorization bearer token |
| `WHATSAPP_BRIDGE_URL` | Production | HTTPS URL of persistent bridge (e.g. `https://wa.whyteautomation.com`) |
| `WHATSAPP_BRIDGE_SECRET` | Production | Shared bearer secret connecting Vercel to WhatsApp bridge |
| `DISABLE_PUBLIC_DNS_OVERRIDE` | Production | Set to `"true"` on Vercel |

### Step 4: Post-Deployment Smoke Test
Verify the deployment immediately:
1. Probe liveness: `curl -f -I https://<your-domain>/api/health/liveness` (Expect HTTP 200).
2. Verify headers: Confirm `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
3. Check login: Navigate to `/admin/login` and test authentication.

---

## 3. WhatsApp Bridge Operations Guide

Because Vercel serverless functions terminate between requests, the WhatsApp daemon runs in a **persistent container** with mounted disk storage.

### Option A: Railway Deployment (Recommended)
1. In Railway, click **New Project > Deploy from GitHub repo**.
2. Set Dockerfile path to `Dockerfile.whatsapp`.
3. Add a **Persistent Volume**:
   - Mount path: `/app/.wwebjs_auth`
   - Volume size: 1 GB minimum.
4. Set Environment Variables:
   - `PORT_WHATSAPP_BRIDGE=5005`
   - `NODE_ENV=production`
   - `WHATSAPP_BRIDGE_SECRET=<strong-random-secret>`
5. Generate a public domain (e.g. `https://whyte-wa.up.railway.app`).
6. Point Vercel's `WHATSAPP_BRIDGE_URL` to this Railway URL.

### Option B: VPS Deployment via Docker Compose
1. SSH into VPS (Ubuntu 22.04 / 24.04 LTS).
2. Clone repository or copy `docker-compose.whatsapp.yml` and `Dockerfile.whatsapp`.
3. Create `.env` file containing `WHATSAPP_BRIDGE_SECRET=<secret>`.
4. Run:
   ```bash
   docker compose -f docker-compose.whatsapp.yml up -d
   ```
5. Configure reverse proxy (Nginx / Caddy / Cloudflare Tunnel) with SSL termination forwarding port 5005.

### Account Linking (QR Code Authentication)
1. Open in browser: `https://<bridge-domain>/qr`
2. Browser prompt will request authentication: enter `:WHATSAPP_BRIDGE_SECRET` as password.
3. Open WhatsApp on company smartphone > **Linked Devices > Link a Device**.
4. Scan the rendered QR code.
5. The screen automatically updates to **Connected: +91 XXXXX XXXXX**.

### Recovery & Reconnect Procedures
- **Unlinking/Switching numbers**: Send `POST /logout` with Bearer auth to regenerate fresh QR.
- **Abrupt crash recovery**: The bridge automatically runs `clearStaleChromeLocks()` on startup to delete dangling Chromium lockfiles before booting Puppeteer.

---

## 4. MongoDB Backup & Disaster Recovery Runbook

### Backup Capabilities & Architecture
- **Primary Tier**: MongoDB Atlas automated cloud backups.
- **Recovery Point Objective (RPO)**:
  - Atlas Continuous Cloud Backup (M10+): RPO < 1 minute (Point-in-Time Recovery).
  - Snapshot Schedule: Daily snapshot retained for 30 days, weekly snapshot retained for 52 weeks.
- **Recovery Time Objective (RTO)**:
  - RTO < 15 minutes to provision replacement cluster or restore to point in time.

### Disaster Recovery Rehearsal & Restore Procedure
> **CRITICAL**: Never restore data over a live production database. Always restore to a **new cluster or test database**, inspect integrity, then switch the connection string.

1. **Initiate Restore in Atlas Console**:
   - Go to **Database Deployments > Backup**.
   - Click **Restore > Point in Time** or select specific Snapshot.
   - Select **Restore to a New Cluster** (e.g. `whyte-restore-test`).
2. **Post-Restore Integrity Validation**:
   - Verify collections count matches production.
   - Run index audit:
     ```bash
     MONGODB_URI="<restored-db-uri>" INDEX_AUDIT_APPROVED=yes \
     npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/indexes.ts audit --allow-remote --check-unique
     ```
   - Check unique indexes on `roomtypes` and `roomtemplates`.
   - Verify quotation count and revision snapshots match before disaster.
3. **Switch Production Traffic**:
   - Update `MONGODB_URI` in Vercel Environment Variables.
   - Trigger instant zero-downtime redeployment.

---

## 5. Incident Response Guide

### Severity Definitions
| Level | Impact | Initial Response Window |
|---|---|---|
| **P0 (Critical)** | Core quotation system completely down; database unreachable | < 15 minutes |
| **P1 (High)** | WhatsApp delivery failing; PDF generation blocked | < 1 hour |
| **P2 (Medium)** | Non-blocking admin dashboard issue; email verification delay | < 4 hours |
| **P3 (Low)** | Minor UI styling glitch; non-critical telemetry issue | Next business day |

### P0 Incident: Database Connection Outage
1. **Symptom**: HTTP 500 responses with `[mongodb] connection attempt failed`.
2. **Verification**: Probe `GET /api/health/liveness` (returns 200 = Vercel is alive). Probe `GET /api/health` (authenticated) to check DB driver message.
3. **Action**:
   - Check Atlas Network Access IP Whitelist (verify 0.0.0.0/0 or AWS NAT Gateway IPs).
   - Check Atlas cluster compute and connection count.
   - If cluster failed, execute Atlas automated failover to replica secondary.

### P1 Incident: WhatsApp Delivery Offline
1. **Symptom**: Quotation delivery modal shows WhatsApp bridge offline.
2. **Fallback**: The platform **automatically offers the fallback "Share via WhatsApp Web (`wa.me`)" button**. Salespeople can continue dispatching quotations manually.
3. **Action**:
   - Check bridge container logs: `docker logs whyte-whatsapp-bridge`.
   - Probe `GET /health` on bridge container.
   - If WhatsApp session was revoked from the mobile phone, open `https://<bridge-domain>/qr` and scan a new QR code.

---

## 6. Rollback Procedures

### Vercel Application Rollback (Zero Downtime)
1. Go to Vercel Dashboard > **Deployments**.
2. Locate the previous stable production deployment.
3. Click the three dots `...` > **Instant Rollback**.
4. Traffic routes to the previous build within 5 seconds without rebuilding.

### Database Index or Schema Revert
All indexes are deployed under controlled scripts (`scripts/indexes.ts`). If an index requires dropping:
```bash
node -e "
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.collection('<collection>').dropIndex('<index_name>');
  process.exit(0);
})();"
```

---

## 7. Administrator Troubleshooting Guide

| Issue | Root Cause | Solution |
|---|---|---|
| **Login Throttled ("Too many failed attempts")** | Account failed 5+ times or IP failed 25+ times | Wait 15 minutes, or have Super Admin reset rate-limit document in `auth_rate_limits` collection. |
| **WhatsApp returns 401 Unauthorized** | `WHATSAPP_BRIDGE_SECRET` mismatch | Ensure `WHATSAPP_BRIDGE_SECRET` on Vercel exactly matches the container env var. |
| **PDF download blank or missing** | Delivery file not frozen | Check `quotationdeliveryfiles` collection for matching delivery ID. If unfrozen, quotation preview regenerates client-side. |
| **Target Room Type shows conflict** | Room type already has a configured template | Exactly one template per room type rule is active. Click "Edit Existing" instead of creating a second template. |

---

## 8. Production Maintenance Checklist

### Monthly
- [ ] Review MongoDB Atlas storage growth and connection usage.
- [ ] Check Vercel function execution duration metrics.
- [ ] Verify WhatsApp linked device status on the company phone.
- [ ] Review error logs in `errorMonitoring` for repeated exception digests.

### Quarterly
- [ ] Perform non-production backup restore drill to verify RPO/RTO.
- [ ] Audit user access in `/admin/users` (deactivate former employees/dealers).
- [ ] Check dependency vulnerability updates with `npm audit`.
- [ ] Rotate `NEXTAUTH_SECRET` and `WHATSAPP_BRIDGE_SECRET` if credentials changed.

