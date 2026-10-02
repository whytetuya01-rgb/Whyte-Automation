import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "../src/lib/mongodb";
import { AdminUser } from "../src/models/AdminUser";
import { getNextSequence } from "../src/lib/counter";

/**
 * Idempotent Admin User Creation Script for MongoDB / Mongoose.
 *
 * Usage:
 *   node -e "require('ts-node').register({compilerOptions:{module:'CommonJS'}}); require('tsconfig-paths').register({baseUrl: './', paths: {'@/*': ['src/*']}}); require('./scripts/create-admin-mongodb.ts');"
 *
 * Configurable via environment variables:
 *   ADMIN_EMAIL (default: "admin@whyte.com")
 *   ADMIN_PASSWORD (default: "Whyte@@@")
 *   ADMIN_NAME (default: "Admin")
 *   ADMIN_ROLE (default: "super_admin")
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@whyte.com").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "Whyte@@@";
  const name = (process.env.ADMIN_NAME || "Admin").trim();
  const role = (process.env.ADMIN_ROLE || "super_admin") as "super_admin" | "admin" | "sales";

  console.log(`Connecting to MongoDB...`);
  const mongooseInstance = await connectMongoDB();
  console.log(`Connected to database: ${mongooseInstance.connection.name}`);

  console.log(`Checking for existing admin user: ${email}`);
  const existingUser = await AdminUser.findOne({ email });

  const passwordHash = await bcrypt.hash(password, 12);

  if (existingUser) {
    existingUser.passwordHash = passwordHash;
    existingUser.name = name;
    existingUser.role = role;
    existingUser.isActive = true;
    await existingUser.save();

    console.log(`✅ Existing admin detected (ID: ${existingUser._id}).`);
    console.log(`   Updated credentials: ${email}`);
    console.log(`   Idempotency maintained: No duplicate user created.`);
  } else {
    const nextId = await getNextSequence("adminUser", AdminUser);
    const newUser = await AdminUser.create({
      _id: nextId,
      email,
      passwordHash,
      name,
      role,
      isActive: true,
      createdAt: new Date(),
    });

    console.log(`✅ Admin user created successfully (ID: ${newUser._id}).`);
    console.log(`   Email: ${email}`);
    console.log(`   Role: ${role}`);
  }

  await mongooseInstance.disconnect();
  console.log("Database disconnected. Admin setup complete.");
}

main().catch((error) => {
  console.error("❌ Admin creation script failed:", error);
  process.exit(1);
});
