# DATABASE ARCHITECTURE — CURRENT STATE
### Whyte Quotation Application
**Document purpose:** Pre-migration reference snapshot of the existing PostgreSQL database architecture.
**Generated:** 2026-09-28
**Status:** Read-only analysis. No code was modified.

---

## TABLE OF CONTENTS

1. [Technology Stack](#1-technology-stack)
2. [Database Schema](#2-database-schema)
   - [Company](#21-company)
   - [Category](#22-category)
   - [Product](#23-product)
   - [ProductVariant](#24-productvariant)
   - [HouseType](#25-housetype)
   - [RoomType](#26-roomtype)
   - [HouseTypeRoomTemplate](#27-housetyperoommtemplate)
   - [Quotation](#28-quotation)
   - [QuotationRoom](#29-quotationroom)
   - [QuotationItem](#210-quotationitem)
   - [AdminUser](#211-adminuser)
3. [Enums](#3-enums)
4. [Relationships](#4-relationships)
5. [Relationship Diagram (Mermaid ER)](#5-relationship-diagram-mermaid-er)
6. [Docker / Database Runtime Architecture](#6-docker--database-runtime-architecture)
   - [28.1 Docker Services](#281-docker-services)
   - [28.2 Current Database Startup Flow](#282-current-database-startup-flow)
   - [28.3 What Happens When Docker Is Not Running](#283-what-happens-when-docker-is-not-running)
   - [28.4 Database Connection String](#284-database-connection-string)
   - [28.5 Docker Network Architecture](#285-docker-network-architecture)
   - [28.6 Port Mapping](#286-port-mapping)
   - [28.7 Volumes / Data Persistence](#287-volumes--data-persistence)
   - [28.8 Database Initialization](#288-database-initialization)
   - [28.9 Prisma + Docker Flow](#289-prisma--docker-flow)
   - [28.10 Development Startup Commands](#2810-development-startup-commands)
   - [28.11 Docker Dependency Summary](#2811-docker-dependency-summary)
   - [28.12 Future MongoDB Migration Impact](#2812-future-mongodb-migration-impact)
   - [28.13 Final Docker Diagram](#2813-final-docker-diagram)

---

## 1. TECHNOLOGY STACK

| Layer | Technology | Version / Detail |
|---|---|---|
| **Framework** | Next.js | `16.2.3` (App Router) |
| **Runtime** | React | `19.2.4` |
| **Language** | TypeScript | `^5` |
| **Node.js requirement** | Not explicitly declared in `package.json` or `.nvmrc` | Not found / Could not determine |
| **Backend architecture** | Next.js API Routes (server-side, co-located in `src/app/api/`) — **no separate backend process** | |
| **Database** | PostgreSQL | Version not explicitly pinned; connected via `pg ^8.20.0` |
| **ORM** | **Prisma** | `^7.7.0` (client) / `^7.8.0` (CLI dev dependency) |
| **Prisma adapter** | `@prisma/adapter-pg` | `^7.7.0` — uses a native `pg` pool under Prisma |
| **Raw PostgreSQL driver** | `pg` | `^8.20.0` (used inside Prisma adapter) |
| **Authentication** | `next-auth` | `^4.24.13` — JWT-session strategy, CredentialsProvider backed by `AdminUser` table |
| **Password hashing** | `bcryptjs` | `^3.0.3` |
| **Image hosting** | Cloudinary | `^2.10.0` (optional, for product/company `imageUrl`/`logoUrl`) |
| **Deployment target** | Vercel | `vercel.json` present; build command runs `prisma generate && next build` |
| **Schema file** | `prisma/schema.prisma` | Single-file schema, `provider = "postgresql"` |
| **Migrations directory** | `prisma/migrations/` | Prisma Migrate (one migration: `20260611122353_init`) |
| **Seed script** | `prisma/seed.ts` | Run via `ts-node` |

### Database-related packages (complete list)

| Package | Type | Purpose |
|---|---|---|
| `@prisma/client ^7.7.0` | dependency | Generated Prisma Client used throughout API routes |
| `@prisma/adapter-pg ^7.7.0` | dependency | Connects Prisma to a `node-postgres` (`pg`) pool |
| `pg ^8.20.0` | dependency | PostgreSQL connection pool (`Pool`) |
| `prisma ^7.8.0` | devDependency | Prisma CLI (migrations, generate, studio, seed) |
| `@types/pg ^8.20.0` | devDependency | TypeScript types for `pg` |
| `next-auth ^4.24.13` | dependency | Auth layer; reads `AdminUser` from DB for login |
| `bcryptjs ^3.0.3` | dependency | Hashes and verifies passwords stored in `AdminUser.passwordHash` |
| `dotenv ^17.4.1` | devDependency | Loads `.env` for seed/migration scripts run outside Next.js |

---

## 2. DATABASE SCHEMA

> **Source of truth:** `prisma/schema.prisma` + `prisma/migrations/20260611122353_init/migration.sql`
>
> **Naming convention:** Prisma uses PascalCase model names which map to quoted PascalCase PostgreSQL table names (e.g. `"Company"`, `"AdminUser"`).

---

### 2.1 `Company`

**Purpose:** Stores the single seller/vendor company profile (name, contact, branding). Used on generated quotation PDFs. Expected to have exactly **one row** (id = 1).

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** `updatedAt` (auto-managed by Prisma `@updatedAt`). No `createdAt`.

**Soft-delete:** Not present.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `name` | `TEXT` | `String` | YES | — | No | Company display name |
| `gstNumber` | `TEXT` | `String?` | NO | NULL | No | GST registration number |
| `phone` | `TEXT` | `String` | YES | — | No | Primary contact phone |
| `email` | `TEXT` | `String?` | NO | NULL | No | Contact email address |
| `address` | `TEXT` | `String` | YES | — | No | Full postal address |
| `logoUrl` | `TEXT` | `String?` | NO | NULL | No | Cloudinary URL for company logo |
| `tagline` | `TEXT` | `String?` | NO | NULL | No | Marketing tagline shown on PDFs |
| `updatedAt` | `TIMESTAMP(3)` | `DateTime` | YES | Prisma `@updatedAt` | No | Last modification timestamp |

**Indexes:** Primary key index on `id` only. No additional indexes.

---

### 2.2 `Category`

**Purpose:** Hierarchical product categories (product series/lines such as Tactus, Tactus Edge, Accessories, etc.). Supports a self-referential tree via `parentId`. Currently used with `level = 1` (flat list) in seed data, but the model supports multi-level trees. Stores variant configuration metadata (`variantTiers`, `variantFinishes`) as JSONB.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** `createdAt` only. No `updatedAt`.

**Soft-delete:** `isActive` boolean (logical soft-disable, not deletion).

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `name` | `TEXT` | `String` | YES | — | No | Category/series name (e.g. "Tactus") |
| `level` | `INTEGER` | `Int` | YES | — | No | Tree depth (1 = root, 2 = subcategory, etc.) |
| `parentId` | `INTEGER` | `Int?` | NO | NULL | No | FK → `Category.id`; NULL for root categories |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering weight |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Soft-disable flag |
| `createdAt` | `TIMESTAMP(3)` | `DateTime` | YES | `CURRENT_TIMESTAMP` | No | Record creation timestamp |
| `variantTiers` | `JSONB` | `Json?` | NO | NULL | No | Array of `{value, label}` objects for automation tier options |
| `variantFinishes` | `JSONB` | `Json?` | NO | NULL | No | Array of `{value, label}` objects for surface finish options |

**Indexes:** Primary key on `id`. FK index on `parentId` (implicit via FK constraint).

**Self-relation:** `Category_parentId_fkey` — `ON DELETE SET NULL ON UPDATE CASCADE`.

**JSONB structure examples (from seed):**
```json
// variantTiers
[{ "value": "remote", "label": "Remote Control" }, { "value": "wifi", "label": "WiFi Smart" }]

// variantFinishes
[{ "value": "acrylic", "label": "Acrylic Panel" }, { "value": "glass", "label": "Glass Panel" }]
```

---

### 2.3 `Product`

**Purpose:** Master product catalogue. Covers switch boards, accessories, retrofit modules, curtains, smart locks, VDPs, and other items. Supports both simple flat-price products and matrix-priced products (where price depends on multiple dimensions). The `price` field stores the minimum/base price for display purposes ("From X"); actual per-variant prices live in `ProductVariant`.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** `createdAt`, `updatedAt` (Prisma `@updatedAt`).

**Soft-delete:** `isActive` boolean.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `name` | `TEXT` | `String` | YES | — | No | Product display name |
| `code` | `TEXT` | `String?` | NO | NULL | No | Internal product code / SKU (e.g. "T4S-2M") |
| `description` | `TEXT` | `String?` | NO | NULL | No | Optional product description |
| `type` | `"ProductType"` (enum) | `ProductType` | YES | — | No | Product category type; see enum values below |
| `categoryId` | `INTEGER` | `Int?` | NO | NULL | No | FK → `Category.id`; nullable (product may have no category) |
| `price` | `DECIMAL(10,2)` | `Decimal` | YES | `0` | No | Base/minimum price (for display); actual prices in variants |
| `unit` | `TEXT` | `String` | YES | `'pcs'` | No | Unit of measure (e.g. "pcs", "set") |
| `imageUrl` | `TEXT` | `String?` | NO | NULL | No | Cloudinary product image URL |
| `moduleSize` | `TEXT` | `String?` | NO | NULL | No | Physical module size (e.g. "2M", "4M", "6M", "8M", "12M") |
| `notes` | `TEXT` | `String?` | NO | NULL | No | Internal product notes |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Soft-disable flag |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering weight |
| `createdAt` | `TIMESTAMP(3)` | `DateTime` | YES | `CURRENT_TIMESTAMP` | No | Record creation timestamp |
| `updatedAt` | `TIMESTAMP(3)` | `DateTime` | YES | Prisma `@updatedAt` | No | Last update timestamp |
| `isMatrix` | `BOOLEAN` | `Boolean` | YES | `false` | No | `true` if product uses matrix (multi-dimension) pricing |
| `matrixDimensions` | `JSONB` | `Json?` | NO | NULL | No | Array of dimension definitions when `isMatrix = true` |

**Indexes:** PK on `id`. Implicit FK index on `categoryId`.

**`matrixDimensions` JSONB structure:**
```json
[
  { "key": "series", "label": "Series", "options": ["remote", "wifi", "zigbee"] },
  { "key": "finish", "label": "Finish",  "options": ["acrylic", "glass"] }
]
```

---

### 2.4 `ProductVariant`

**Purpose:** Stores individual price points for a product per combination of dimensions (automation tier x surface finish). For flat-price products, there is exactly one variant with `automationTier = NULL`, `surfaceFinish = NULL`, and `config = {}`. For matrix products, each combination of tier + finish has its own row. The `config` JSONB is the canonical dimension snapshot used at quotation time.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** `isActive` boolean.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `productId` | `INTEGER` | `Int` | YES | — | No | FK → `Product.id` (CASCADE delete) |
| `automationTier` | `TEXT` | `String?` | NO | NULL | No | Legacy tier label (e.g. "remote", "wifi", "zigbee"); nullable for flat products |
| `surfaceFinish` | `TEXT` | `String?` | NO | NULL | No | Legacy finish label (e.g. "acrylic", "glass"); nullable for flat products |
| `config` | `JSONB` | `Json` | YES | `'{}'` | No | Generic N-dimensional config snapshot (e.g. `{"series":"wifi","finish":"glass"}`) |
| `price` | `DECIMAL(10,2)` | `Decimal` | YES | — | No | Exact price for this variant combination |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Soft-disable flag |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering within a product's variants |

**Indexes:** PK on `id`. Implicit FK index on `productId`.

**Delete behavior:** `ON DELETE CASCADE` — deleting a `Product` deletes all its `ProductVariant` rows.

---

### 2.5 `HouseType`

**Purpose:** Lookup table for residential property types (1 BHK, 2 BHK, 3 BHK, 4 BHK, Duplex, Villa, Penthouse). Used when creating a quotation to auto-populate a standard room list via `HouseTypeRoomTemplate`.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** `isActive` boolean.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `name` | `TEXT` | `String` | YES | — | No | House type label (e.g. "3 BHK") |
| `description` | `TEXT` | `String?` | NO | NULL | No | Optional description (e.g. "3 Bedrooms, Hall, Kitchen") |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Soft-disable flag |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering weight |

**Indexes:** PK on `id` only.

---

### 2.6 `RoomType`

**Purpose:** Lookup/master list of room types (Living Room, Master Bedroom, Kitchen, Balcony, etc.). Referenced by `HouseTypeRoomTemplate` (templates) and `QuotationRoom` (actual rooms in a quotation).

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** `isActive` boolean.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `name` | `TEXT` | `String` | YES | — | No | Room type name (e.g. "Living Room") |
| `icon` | `TEXT` | `String?` | NO | NULL | No | Optional icon identifier (set to NULL in seed; previously emoji) |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Soft-disable flag |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering weight |

**Indexes:** PK on `id` only.

**Seeded values (28 room types):** Living Room, Master Bedroom, Bedroom 2-4, Kids Room, Guest Room, Kitchen, Dining Room, Study Room, Home Office, Puja Room, Home Theatre, Gym, Balcony 1-2, Terrace, Garden, Entrance / Foyer, Corridor, Staircase, Powder Room, Laundry, Store Room, Garage, Servant Room, Driver Room, Common Area.

---

### 2.7 `HouseTypeRoomTemplate`

**Purpose:** Join/bridge table that defines which room types belong to a given house type, and in what default quantity. Acts as a template to auto-populate `QuotationRoom` entries when a new quotation is created for a house type.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** Not present.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `houseTypeId` | `INTEGER` | `Int` | YES | — | No | FK → `HouseType.id` (RESTRICT delete) |
| `roomTypeId` | `INTEGER` | `Int` | YES | — | No | FK → `RoomType.id` (RESTRICT delete) |
| `defaultCount` | `INTEGER` | `Int` | YES | `1` | No | Number of instances of this room type in the house |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering within the house type's room list |

**Indexes:** PK on `id`. FK indexes on `houseTypeId` and `roomTypeId`.

**Delete behavior:** Both FK constraints use `ON DELETE RESTRICT` — you cannot delete a `HouseType` or `RoomType` that still has template rows referencing it.

---

### 2.8 `Quotation`

**Purpose:** The core business entity. Represents a sales quotation issued to a client. Contains all client-facing information, discount configuration, validity, status lifecycle, and links to its rooms/items. The primary key is a CUID string (not integer) for URL-safety and global uniqueness.

**Primary key:** `id` — `TEXT` (CUID generated by Prisma `@default(cuid())`)

**Timestamps:** `createdAt`, `updatedAt` (Prisma `@updatedAt`).

**Soft-delete:** Not present (uses `status` enum for lifecycle management instead).

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `TEXT` | `String` | YES | `cuid()` | PK (CUID) | CUID string primary key |
| `quotationNumber` | `TEXT` | `String` | YES | — | YES | Human-readable quotation number (e.g. "Q-2026-0001"); unique index |
| `clientName` | `TEXT` | `String` | YES | — | No | Full name of the client |
| `clientGstNumber` | `TEXT` | `String?` | NO | NULL | No | Client's GST registration number |
| `clientPhone` | `TEXT` | `String?` | NO | NULL | No | Client phone number |
| `clientEmail` | `TEXT` | `String?` | NO | NULL | No | Client email address |
| `clientAddress` | `TEXT` | `String?` | NO | NULL | No | Client's site/delivery address |
| `houseTypeId` | `INTEGER` | `Int?` | NO | NULL | No | FK → `HouseType.id` (SET NULL on delete) |
| `status` | `"QuotationStatus"` (enum) | `QuotationStatus` | YES | `'draft'` | No | Lifecycle status; see enum values |
| `notes` | `TEXT` | `String?` | NO | NULL | No | Internal/visible notes on the quotation |
| `discountType` | `"DiscountType"` (enum) | `DiscountType?` | NO | NULL | No | Discount strategy; see enum values |
| `discountValue` | `DECIMAL(10,2)` | `Decimal?` | NO | NULL | No | Discount amount (percentage or fixed rupees) |
| `terms` | `TEXT` | `String?` | NO | NULL | No | Terms & conditions text shown on the PDF |
| `validUntil` | `TIMESTAMP(3)` | `DateTime?` | NO | NULL | No | Quotation expiry date |
| `defaultTier` | `TEXT` | `String?` | NO | NULL | No | Default automation tier applied to new items in this quotation |
| `defaultFinish` | `TEXT` | `String?` | NO | NULL | No | Default surface finish applied to new items in this quotation |
| `createdAt` | `TIMESTAMP(3)` | `DateTime` | YES | `CURRENT_TIMESTAMP` | No | Record creation timestamp |
| `updatedAt` | `TIMESTAMP(3)` | `DateTime` | YES | Prisma `@updatedAt` | No | Last update timestamp |
| `createdBy` | `TEXT` | `String?` | NO | NULL | No | Admin user identifier who created the quotation (not a FK) |

**Indexes:**
- PK on `id`
- `Quotation_quotationNumber_key` — unique index on `quotationNumber`
- Implicit FK index on `houseTypeId`

---

### 2.9 `QuotationRoom`

**Purpose:** Represents a physical room within a quotation. Each `Quotation` has one or more `QuotationRoom` entries. Rooms are either typed (linked to a `RoomType`) or custom-named. Each room contains multiple `QuotationItem` line entries.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** Not present.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `quotationId` | `TEXT` | `String` | YES | — | No | FK → `Quotation.id` (CASCADE delete) |
| `roomTypeId` | `INTEGER` | `Int?` | NO | NULL | No | FK → `RoomType.id` (SET NULL on delete); optional if custom name used |
| `customName` | `TEXT` | `String?` | NO | NULL | No | Free-text name override when no standard room type applies |
| `subArea` | `TEXT` | `String?` | NO | NULL | No | Sub-area label (e.g. "Attached Bathroom") |
| `notes` | `TEXT` | `String?` | NO | NULL | No | Room-level notes |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering within the quotation |

**Indexes:** PK on `id`. FK indexes on `quotationId` and `roomTypeId`.

**Delete behavior:**
- `quotationId` FK: `ON DELETE CASCADE` — deleting a `Quotation` removes all its rooms.
- `roomTypeId` FK: `ON DELETE SET NULL` — deleting a `RoomType` sets `roomTypeId` to NULL.

---

### 2.10 `QuotationItem`

**Purpose:** A single line item within a `QuotationRoom`. Records which product (and optionally which variant) was selected, quantity, unit price at time of addition, and a config snapshot. The `variantConfig` JSONB preserves the exact dimension values selected at quotation time, even if the product's variants change later (immutable snapshot).

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** None.

**Soft-delete:** Not present.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `quotationRoomId` | `INTEGER` | `Int` | YES | — | No | FK → `QuotationRoom.id` (CASCADE delete) |
| `productId` | `INTEGER` | `Int` | YES | — | No | FK → `Product.id` (RESTRICT delete) |
| `productVariantId` | `INTEGER` | `Int?` | NO | NULL | No | FK → `ProductVariant.id` (SET NULL on delete); optional for flat products |
| `variantLabel` | `TEXT` | `String?` | NO | NULL | No | Human-readable label for the variant (e.g. "WiFi + Glass") |
| `variantConfig` | `JSONB` | `Json?` | NO | NULL | No | Snapshot of dimension values at time of adding (e.g. `{"series":"wifi","finish":"glass"}`) |
| `sbNumber` | `TEXT` | `String?` | NO | NULL | No | Switch board number / reference label |
| `quantity` | `INTEGER` | `Int` | YES | `1` | No | Quantity of units |
| `unitPrice` | `DECIMAL(10,2)` | `Decimal` | YES | — | No | Price per unit at time of quotation (snapshot, not live from product) |
| `notes` | `TEXT` | `String?` | NO | NULL | No | Line item notes |
| `sortOrder` | `INTEGER` | `Int` | YES | `0` | No | Display ordering within the room |

**Indexes:** PK on `id`. FK indexes on `quotationRoomId`, `productId`, `productVariantId`.

**Delete behavior:**
- `quotationRoomId` FK: `ON DELETE CASCADE` — deleting a `QuotationRoom` removes all its items.
- `productId` FK: `ON DELETE RESTRICT` — cannot delete a `Product` that has quotation items referencing it.
- `productVariantId` FK: `ON DELETE SET NULL` — deleting a `ProductVariant` sets `productVariantId` to NULL (preserves the item with the snapshot).

---

### 2.11 `AdminUser`

**Purpose:** Application user accounts for the admin panel. Authentication is handled by `next-auth` using the `CredentialsProvider` which queries this table. Passwords are stored as bcrypt hashes. Roles control access levels within the admin UI.

**Primary key:** `id` — `SERIAL` (auto-increment integer)

**Timestamps:** `createdAt` only. No `updatedAt`.

**Soft-delete:** `isActive` boolean.

| Column | PostgreSQL Type | Prisma Type | Required | Default | Unique | Description |
|---|---|---|---|---|---|---|
| `id` | `SERIAL` / `INTEGER` | `Int` | YES | auto-increment | PK | Primary key |
| `email` | `TEXT` | `String` | YES | — | YES | Login email; unique index `AdminUser_email_key` |
| `passwordHash` | `TEXT` | `String` | YES | — | No | bcrypt hash of the user's password |
| `name` | `TEXT` | `String?` | NO | NULL | No | Display name |
| `role` | `"AdminRole"` (enum) | `AdminRole` | YES | `'sales'` | No | Access role; see enum values |
| `isActive` | `BOOLEAN` | `Boolean` | YES | `true` | No | Account enabled/disabled flag; checked on every login |
| `createdAt` | `TIMESTAMP(3)` | `DateTime` | YES | `CURRENT_TIMESTAMP` | No | Account creation timestamp |

**Indexes:**
- PK on `id`
- `AdminUser_email_key` — unique index on `email`

---

## 3. ENUMS

All enums are PostgreSQL native `ENUM` types created via Prisma migrations.

### `ProductType`

Controls the product category type. Determines icon, display grouping, and PDF rendering behaviour.

| Value | Description |
|---|---|
| `switch_board` | Touch switch panel (Tactus series, Tactus Edge, etc.) |
| `accessory` | Accessories (IR blasters, sensors, gateways, remotes) |
| `retrofit` | Retrofit in-wall switch modules |
| `curtain` | Smart curtain motors/controllers |
| `smart_lock` | Smart door locks |
| `vdp` | Video Door Phone units (indoor + outdoor) |
| `other` | Catch-all for uncategorized products |

### `QuotationStatus`

Lifecycle states of a quotation.

| Value | Description |
|---|---|
| `draft` | Being prepared; not yet sent to client (default) |
| `sent` | Sent to client for review |
| `approved` | Client has accepted the quotation |
| `rejected` | Client has declined the quotation |

### `DiscountType`

Controls how the `discountValue` on a `Quotation` is applied.

| Value | Description |
|---|---|
| `percentage` | `discountValue` is a percentage (e.g. 10 = 10% off total) |
| `fixed` | `discountValue` is a fixed rupee amount off the total |
| `none` | No discount; `discountValue` is ignored |

### `AdminRole`

Role-based access control for admin users.

| Value | Description |
|---|---|
| `super_admin` | Full access including user management and company settings |
| `admin` | Standard admin access |
| `sales` | Sales staff; limited to quotation management (default) |

---

## 4. RELATIONSHIPS

### Summary Table

| Source Table | Source Field | Target Table | Target Field | Relationship Type | On Delete | On Update |
|---|---|---|---|---|---|---|
| `Category` | `parentId` | `Category` | `id` | Many-to-One (self-referential tree) | SET NULL | CASCADE |
| `Product` | `categoryId` | `Category` | `id` | Many-to-One | SET NULL | CASCADE |
| `ProductVariant` | `productId` | `Product` | `id` | Many-to-One | CASCADE | CASCADE |
| `HouseTypeRoomTemplate` | `houseTypeId` | `HouseType` | `id` | Many-to-One | RESTRICT | CASCADE |
| `HouseTypeRoomTemplate` | `roomTypeId` | `RoomType` | `id` | Many-to-One | RESTRICT | CASCADE |
| `Quotation` | `houseTypeId` | `HouseType` | `id` | Many-to-One | SET NULL | CASCADE |
| `QuotationRoom` | `quotationId` | `Quotation` | `id` | Many-to-One | CASCADE | CASCADE |
| `QuotationRoom` | `roomTypeId` | `RoomType` | `id` | Many-to-One | SET NULL | CASCADE |
| `QuotationItem` | `quotationRoomId` | `QuotationRoom` | `id` | Many-to-One | CASCADE | CASCADE |
| `QuotationItem` | `productId` | `Product` | `id` | Many-to-One | RESTRICT | CASCADE |
| `QuotationItem` | `productVariantId` | `ProductVariant` | `id` | Many-to-One | SET NULL | CASCADE |

### Key Relationship Chains

```
Category (self-referential tree)
  └─ Category (children)

Category
  └─ Product (Many)
       └─ ProductVariant (Many, CASCADE)
             └─ QuotationItem (Many, SET NULL on variant delete)

HouseType ─── HouseTypeRoomTemplate ─── RoomType
  (RESTRICT)                              (RESTRICT)

HouseType
  └─ Quotation (Many, SET NULL)
       └─ QuotationRoom (Many, CASCADE)
             ├─ RoomType (SET NULL)
             └─ QuotationItem (Many, CASCADE)
                   ├─ Product (RESTRICT)
                   └─ ProductVariant (SET NULL)
```

### Cascade Delete Chains

Deleting a **`Quotation`** cascades:
```
Quotation ──CASCADE──► QuotationRoom ──CASCADE──► QuotationItem
```

Deleting a **`Product`** cascades:
```
Product ──CASCADE──► ProductVariant
Product ──RESTRICT── QuotationItem  (BLOCKED if items exist referencing the product)
```

---

## 5. RELATIONSHIP DIAGRAM (MERMAID ER)

```mermaid
erDiagram
    CATEGORY {
        int id PK
        string name
        int level
        int parentId FK
        int sortOrder
        boolean isActive
        datetime createdAt
        json variantTiers
        json variantFinishes
    }
    CATEGORY ||--o{ CATEGORY : "parent to children"

    PRODUCT {
        int id PK
        string name
        string code
        string description
        enum type
        int categoryId FK
        decimal price
        string unit
        string imageUrl
        string moduleSize
        string notes
        boolean isActive
        int sortOrder
        datetime createdAt
        datetime updatedAt
        boolean isMatrix
        json matrixDimensions
    }
    CATEGORY ||--o{ PRODUCT : "has products"

    PRODUCT_VARIANT {
        int id PK
        int productId FK
        string automationTier
        string surfaceFinish
        json config
        decimal price
        boolean isActive
        int sortOrder
    }
    PRODUCT ||--o{ PRODUCT_VARIANT : "has variants CASCADE"

    HOUSE_TYPE {
        int id PK
        string name
        string description
        boolean isActive
        int sortOrder
    }

    ROOM_TYPE {
        int id PK
        string name
        string icon
        boolean isActive
        int sortOrder
    }

    HOUSE_TYPE_ROOM_TEMPLATE {
        int id PK
        int houseTypeId FK
        int roomTypeId FK
        int defaultCount
        int sortOrder
    }
    HOUSE_TYPE ||--o{ HOUSE_TYPE_ROOM_TEMPLATE : "defines rooms RESTRICT"
    ROOM_TYPE ||--o{ HOUSE_TYPE_ROOM_TEMPLATE : "used in templates RESTRICT"

    QUOTATION {
        string id PK
        string quotationNumber
        string clientName
        string clientGstNumber
        string clientPhone
        string clientEmail
        string clientAddress
        int houseTypeId FK
        enum status
        string notes
        enum discountType
        decimal discountValue
        string terms
        datetime validUntil
        string defaultTier
        string defaultFinish
        datetime createdAt
        datetime updatedAt
        string createdBy
    }
    HOUSE_TYPE ||--o{ QUOTATION : "applied to SET NULL"

    QUOTATION_ROOM {
        int id PK
        string quotationId FK
        int roomTypeId FK
        string customName
        string subArea
        string notes
        int sortOrder
    }
    QUOTATION ||--o{ QUOTATION_ROOM : "contains rooms CASCADE"
    ROOM_TYPE ||--o{ QUOTATION_ROOM : "typed as SET NULL"

    QUOTATION_ITEM {
        int id PK
        int quotationRoomId FK
        int productId FK
        int productVariantId FK
        string variantLabel
        json variantConfig
        string sbNumber
        int quantity
        decimal unitPrice
        string notes
        int sortOrder
    }
    QUOTATION_ROOM ||--o{ QUOTATION_ITEM : "contains items CASCADE"
    PRODUCT ||--o{ QUOTATION_ITEM : "referenced by RESTRICT"
    PRODUCT_VARIANT ||--o{ QUOTATION_ITEM : "variant of SET NULL"

    ADMIN_USER {
        int id PK
        string email
        string passwordHash
        string name
        enum role
        boolean isActive
        datetime createdAt
    }
```

---

## 6. DOCKER / DATABASE RUNTIME ARCHITECTURE

---

### 28.1 Docker Services

> **Finding:** After a full scan of the project root and all subdirectories, **no Docker-related files were found.**

The following files were searched and **do not exist** in this project:

| File searched | Found? |
|---|---|
| `docker-compose.yml` | Not found |
| `docker-compose.yaml` | Not found |
| `Dockerfile` | Not found |
| `.dockerignore` | Not found |
| `Makefile` | Not found |
| Any shell scripts in project root | Not found |
| `.env.local` | Not found |
| `.env.development` | Not found |
| `.env.production` | Not found |

> **Conclusion:** This project does **not** use Docker for the database. There are zero Docker services to document.

---

### 28.2 Current Database Startup Flow

Since there is no Docker in this project, the database startup flow is:

```
Developer manually starts a local PostgreSQL instance
  (installed natively on the OS, or via a service manager)
           |
           v
PostgreSQL listens on localhost:5432
           |
           v
Developer creates the database: whyte_quotation
           |
           v
Developer runs: npx prisma migrate dev
           |
           v
Prisma reads DATABASE_URL from .env
           |
           v
Prisma connects to localhost:5432/whyte_quotation
           |
           v
Migration 20260611122353_init applied
  (creates all tables, enums, indexes, FK constraints)
           |
           v
Developer optionally runs: npm run db:seed
  (prisma/seed.ts populates Company, AdminUser,
   RoomTypes, HouseTypes, Categories, Products, Variants)
           |
           v
Developer runs: npm run dev
           |
           v
Next.js starts on localhost:3000
           |
           v
API routes connect via Prisma Client -> pg Pool -> localhost:5432
```

---

### 28.3 What Happens When Docker Is Not Running

**Not applicable** — Docker is not used in this project. PostgreSQL is expected to be running as a **native OS service** (or any external PostgreSQL host specified in `DATABASE_URL`).

If the **PostgreSQL service is stopped / unreachable**, the following occurs:

| Question | Answer |
|---|---|
| Can Next.js start? | **Yes** — Next.js itself starts successfully |
| Can the admin UI load static pages? | Yes — static/cached pages may render |
| Can API routes execute? | **No** — any API route that calls `prisma.*` will fail |
| What error is produced? | `Error: DATABASE_URL environment variable is not set` (if `.env` missing), or `connect ECONNREFUSED 127.0.0.1:5432` (if DB is down) |
| Which component is the direct DB dependency? | `src/lib/prisma.ts` — the `pg.Pool` creation throws on first query if the database is unreachable |
| Authentication affected? | Yes — `next-auth` sign-in calls `prisma.adminUser.findUnique()`, which will fail |
| Connection timeout? | The pool is configured with `connectionTimeoutMillis: 5000` — requests hang for up to 5 seconds before throwing |

**Code evidence** (`src/lib/prisma.ts`):
```typescript
const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000, // Fail after 5 seconds instead of hanging forever
  max: 10,
});
```

---

### 28.4 Database Connection String

**Structure (no secrets exposed):**

```
postgresql://[user]:[password]@localhost:5432/whyte_quotation?schema=public
```

**Source:** `.env` line 5 (comment-documented structure), `prisma.config.ts`, `prisma/schema.prisma` datasource.

| Property | Value |
|---|---|
| Protocol | `postgresql://` |
| Host | **`localhost`** |
| Port | `5432` (standard PostgreSQL port) |
| Database name | `whyte_quotation` |
| Schema | `public` (via query param `?schema=public`) |
| Credentials | Stored in `.env` — not exposed in this document |

> **Important for MongoDB migration:** The database host is `localhost` — meaning PostgreSQL runs on the **same machine as Next.js**, NOT inside a named Docker container. There is no Docker service hostname to replace. Any future MongoDB connection string will similarly point to `localhost` (or a cloud URI like MongoDB Atlas).

**Where `DATABASE_URL` is consumed:**

| Location | How |
|---|---|
| `prisma/schema.prisma` | Datasource block (Prisma reads it at migrate/generate time) |
| `prisma.config.ts` | `process.env["DATABASE_URL"]` with fallback |
| `src/lib/prisma.ts` | `process.env.DATABASE_URL` passed to `pg.Pool` |
| `prisma/seed.ts` | `process.env.DATABASE_URL!` passed to `PrismaPg({ connectionString })` |
| `prisma/create-admin.ts` | `process.env.DATABASE_URL!` passed to `PrismaPg({ connectionString })` |
| `prisma/migrate-to-matrix.ts` | `process.env.DATABASE_URL!` passed to `PrismaPg({ connectionString })` |

---

### 28.5 Docker Network Architecture

**Not applicable** — no Docker network exists.

The actual architecture is:

```
Browser (localhost:3000)
         |
         | HTTP
         v
Next.js App Router (localhost:3000)
  - src/app/(app)/*  -> frontend pages
  - src/app/api/*    -> API routes (server-side)
         |
         | pg.Pool (TCP)
         v
PostgreSQL (localhost:5432)
  - Database: whyte_quotation
  - Schema: public
  - Managed by Prisma Migrate
```

All communication is local TCP on the developer's machine. In production (Vercel), Next.js runs on Vercel infrastructure and `DATABASE_URL` must point to an external/cloud PostgreSQL host (e.g. Supabase, Neon, Railway) — this is documented in the `.env` comments.

---

### 28.6 Port Mapping

| Service | Host Port | Note |
|---|---|---|
| Next.js (dev) | `3000` | `npm run dev` default; `--webpack` flag used |
| PostgreSQL | `5432` | Native OS service on the developer machine |
| Prisma Studio | `5555` | `npm run db:studio` spawns a local browser UI |

No Docker port mappings exist.

---

### 28.7 Volumes / Data Persistence

**Not applicable** — no Docker volumes.

PostgreSQL data persistence depends entirely on the **native PostgreSQL installation** on the developer's OS:

| Aspect | Behaviour |
|---|---|
| Data location | OS-managed PostgreSQL data directory (e.g. `C:\Program Files\PostgreSQL\{version}\data\` on Windows) |
| Survives process restart | Yes — standard PostgreSQL behaviour |
| Survives machine reboot | Yes — data is persisted in the OS file system |
| Survives uninstall | No — uninstalling PostgreSQL may delete the data directory |
| Backup strategy | Not found / Could not determine — no backup scripts present in the project |

> **Important for migration:** Because there are no Docker volumes to export, migrating data to MongoDB will require a direct `pg_dump` from the live PostgreSQL database and a custom ETL script.

---

### 28.8 Database Initialization

The database is initialized through **Prisma Migrate**, not Docker init scripts.

```
Developer installs PostgreSQL natively and creates the database manually
          |
          v
  npm run db:migrate
  (alias: prisma migrate dev)
          |
          v
  Prisma reads prisma/schema.prisma
          |
          v
  Applies migration: 20260611122353_init
    - Creates enums: ProductType, QuotationStatus, DiscountType, AdminRole
    - Creates tables: Company, Category, Product, ProductVariant,
                      HouseType, RoomType, HouseTypeRoomTemplate,
                      Quotation, QuotationRoom, QuotationItem, AdminUser
    - Creates indexes: Quotation_quotationNumber_key, AdminUser_email_key
    - Adds FK constraints with CASCADE/SET NULL/RESTRICT rules
          |
          v
  npm run db:seed
  (alias: prisma db seed -> ts-node prisma/seed.ts)
          |
          v
  Seed populates:
    - 1 Company record
    - 1 AdminUser (super_admin)
    - 28 RoomTypes
    - 7 HouseTypes with HouseTypeRoomTemplate entries
    - 9 Categories
    - 30+ Products with 100+ ProductVariants
          |
          v
  Application is ready
```

**One-time data migration script** (run after schema upgrade, not part of normal init):
```
npx tsx prisma/migrate-to-matrix.ts
  - Backfills Product.isMatrix and Product.matrixDimensions
  - Backfills ProductVariant.config from automationTier/surfaceFinish
  - Backfills QuotationItem.variantConfig from linked variant config
```

---

### 28.9 Prisma + Docker Flow

There is no Docker involved. The actual Prisma flow is:

```
Developer Machine
       |
       |  DATABASE_URL (from .env)
       v
  pg.Pool (node-postgres)
  - host: localhost
  - port: 5432
  - database: whyte_quotation
       |
       v
  PrismaPg adapter
  (@prisma/adapter-pg)
       |
       v
  PrismaClient
  (generated from prisma/schema.prisma)
       |
       +-- Used in: src/lib/prisma.ts (singleton export)
       +-- Used in: src/app/api/** (all API routes import `prisma`)
       +-- Used in: src/lib/auth.ts (NextAuth CredentialsProvider)
       |
       v
  Next.js API Routes
  (src/app/api/categories, products, quotations, etc.)
       |
       v
  Next.js Frontend (React)
  (src/app/(app)/** + src/app/admin/**)
       |
       v
  Browser
```

**Prisma Client singleton pattern** (`src/lib/prisma.ts`):
```typescript
// Prevents multiple PrismaClient instances in Next.js dev hot-reload
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

**Production (Vercel) flow:**
- Vercel build runs `prisma generate && next build` (from `vercel.json`)
- `prisma generate` reads `prisma/schema.prisma` and emits the Prisma Client
- At runtime, `DATABASE_URL` must be set in Vercel environment variables pointing to a cloud PostgreSQL host

---

### 28.10 Development Startup Commands

| Step | Command | Description |
|---|---|---|
| 1 | *(manual)* | Start PostgreSQL service natively on the OS |
| 2 | `npm run db:migrate` | Apply Prisma migrations (`prisma migrate dev`) |
| 3 | `npm run db:seed` | Seed database with initial data (`prisma db seed`) |
| 4 | `npm run dev` | Start Next.js development server on `localhost:3000` |
| — | `npm run db:studio` | Open Prisma Studio GUI at `localhost:5555` (optional) |
| — | `npm run db:reset` | **Destructive** — resets DB and re-runs all migrations + seed |
| — | `npx tsx prisma/migrate-to-matrix.ts` | One-time data migration for matrix pricing backfill |
| — | `npx ts-node --compiler-options {"module":"CommonJS"} prisma/create-admin.ts` | Create/reset admin user |

There is no "start Docker" step. PostgreSQL must already be running on the host.

---

### 28.11 Docker Dependency Summary

**This application does NOT use Docker.**

There is no Docker requirement to run this application. The dependency chain is:

```
Browser
   |
   v
Next.js (npm run dev -> localhost:3000)
   |
   v
Prisma Client + @prisma/adapter-pg
   |
   v
pg.Pool (node-postgres)
   |
   v
PostgreSQL (native OS service -> localhost:5432)
   |
   v
Database: whyte_quotation (created manually by developer)
```

**What must be running for the app to work:**

| Service | Required? | How it runs |
|---|---|---|
| PostgreSQL | **Yes** | Native OS service (not Docker) |
| Next.js | Yes | `npm run dev` |
| Any Docker service | **No** | Not used |
| Redis / cache | No | Not used |
| Any external message queue | No | Not used |

---

### 28.12 Future MongoDB Migration Impact

> This section is **analysis only**. No changes are made.

**Current architecture:**
```
Next.js
   |
   v
Prisma Client (prisma-client-js, postgresql provider)
   |
   v
@prisma/adapter-pg + pg.Pool
   |
   v
DATABASE_URL = postgresql://...@localhost:5432/whyte_quotation
   |
   v
PostgreSQL (native, localhost)
```

**Potential future architecture (MongoDB):**
```
Next.js
   |
   v
Option A: Prisma Client (mongodb provider)
  OR
Option B: Mongoose ODM
  OR
Option C: Native MongoDB Driver
   |
   v
MONGODB_URI = mongodb://...@localhost:27017/whyte_quotation
  OR
MONGODB_URI = mongodb+srv://...@cluster.mongodb.net/whyte_quotation
   |
   v
MongoDB (native service OR MongoDB Atlas cloud)
```

**Files that would need modification (not modified now):**

| File | Current state | What would change |
|---|---|---|
| `prisma/schema.prisma` | `provider = "postgresql"` | Change to `provider = "mongodb"` OR replace Prisma entirely |
| `src/lib/prisma.ts` | Uses `pg.Pool` + `PrismaPg` adapter | Remove `pg` adapter; use MongoDB adapter or Mongoose connection |
| `.env` | `DATABASE_URL=postgresql://...` | Replace with `MONGODB_URI=mongodb://...` |
| `prisma.config.ts` | References `DATABASE_URL` for postgres | Update for MongoDB URL |
| `package.json` | `@prisma/adapter-pg`, `pg`, `@types/pg` | Remove pg packages; add MongoDB driver or Mongoose |
| `next.config.ts` | `serverExternalPackages: ["@prisma/adapter-pg", "pg"]` | Remove pg entries; add MongoDB packages if needed |
| `vercel.json` | `buildCommand: "prisma generate && next build"` | Adjust if Prisma is removed |
| All `src/app/api/**` routes | Use Prisma Client query API | Rewrite queries to MongoDB query syntax |
| `src/lib/auth.ts` | `prisma.adminUser.findUnique()` | Rewrite to MongoDB query |
| All `prisma/migrations/**` | PostgreSQL DDL SQL | Not applicable in MongoDB (no DDL migrations) |

**Schema design considerations for MongoDB:**

| Current PostgreSQL pattern | MongoDB consideration |
|---|---|
| `Quotation.id` is already a CUID string | Natural fit for MongoDB `_id` |
| `Product.id`, `Category.id` etc. are integer SERIAL | MongoDB uses `ObjectId` by default — integer IDs need explicit handling |
| JSONB columns (`config`, `variantConfig`, `matrixDimensions`, `variantTiers`, `variantFinishes`) | Direct fit for MongoDB's native document model |
| PostgreSQL native ENUMs | MongoDB has no native enums — must be enforced at application level (Zod/Mongoose) |
| `DECIMAL(10,2)` for prices | MongoDB has no native `Decimal128` in Prisma; requires careful handling to avoid float precision issues |
| Foreign key constraints with CASCADE/RESTRICT | MongoDB has no FK constraints — must be enforced at application level |
| `HouseTypeRoomTemplate` join table (Many-to-Many) | Can be embedded as array in `HouseType` document |
| `QuotationRoom` + `QuotationItem` hierarchy | Strong candidate for embedding (rooms with nested items) inside `Quotation` document |

---

### 28.13 Final Docker Diagram

Since Docker is not used, the diagram shows the **actual current architecture**:

```mermaid
flowchart TD
    Browser["Browser\nlocalhost:3000"]
    NextJS["Next.js 16\nnpm run dev\nlocalhost:3000"]
    PrismaClient["Prisma Client v7\n@prisma/client"]
    PrismaPg["@prisma/adapter-pg\nPrisma to pg bridge"]
    PgPool["pg.Pool\nnode-postgres v8\nmax: 10 connections\ntimeout: 5000ms"]
    PostgreSQL["PostgreSQL\nnative OS service\nlocalhost:5432\ndatabase: whyte_quotation"]
    DotEnv[".env\nDATABASE_URL\nNEXTAUTH_SECRET\nCLOUDINARY keys"]
    PrismaSchema["prisma/schema.prisma\n11 models / 4 enums"]
    Migration["prisma/migrations/\n20260611122353_init"]
    Seed["prisma/seed.ts\nCompany + Admin +\nRoomTypes + HouseTypes +\nCategories + Products"]
    Cloudinary["Cloudinary\nexternal image CDN\noptional"]

    Browser -->|HTTP requests| NextJS
    NextJS -->|API routes src/app/api| PrismaClient
    NextJS -->|next-auth credentials login| PrismaClient
    PrismaClient --> PrismaPg
    PrismaPg --> PgPool
    PgPool -->|TCP localhost:5432| PostgreSQL
    DotEnv -->|DATABASE_URL| PgPool
    PrismaSchema -->|prisma generate| PrismaClient
    Migration -->|prisma migrate dev| PostgreSQL
    Seed -->|npm run db:seed| PostgreSQL
    NextJS -->|image upload logoUrl / imageUrl| Cloudinary
```

---

*End of document. No application code was modified during this analysis.*
