import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "../src/lib/mongodb";
import { AdminUser, IAdminUserDocument } from "../src/models/AdminUser";
import { getNextSequence } from "../src/lib/counter";

interface UserToCreate {
  email: string;
  name: string;
}

const USERS_TO_CREATE: UserToCreate[] = [
  { email: "bhaviks@whyte.co.in", name: "Bhavik S" },
  { email: "maulikj@whyte.co.in", name: "Maulik J" },
  { email: "mitulv@whyte.co.in", name: "Mitul V" },
  { email: "vrshil77@gmail.com", name: "Vrshil" },
];

const DEFAULT_PASSWORD = "Whyte@2026";
const TARGET_ROLE = "super_admin";

async function main(): Promise<void> {
  console.log("Connecting to MongoDB...");
  const mongooseInstance = await connectMongoDB();
  console.log(`Connected to database: ${mongooseInstance.connection.name}`);

  const createdList: string[] = [];
  const existingList: string[] = [];

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  for (const userConfig of USERS_TO_CREATE) {
    const email = userConfig.email.toLowerCase().trim();
    const existingUser: IAdminUserDocument | null = await AdminUser.findOne({ email });

    if (existingUser) {
      existingList.push(`${email} → ${existingUser.role}`);
    } else {
      const nextId = await getNextSequence("adminUser", AdminUser);
      await AdminUser.create({
        _id: nextId,
        email,
        passwordHash,
        name: userConfig.name,
        role: TARGET_ROLE,
        isActive: true,
        createdAt: new Date(),
      });
      createdList.push(`${email} → ${TARGET_ROLE}`);
    }
  }

  console.log("\nCreated:");
  if (createdList.length > 0) {
    createdList.forEach((item) => console.log(item));
  } else {
    console.log("(None)");
  }

  console.log("\nAlready exists:");
  if (existingList.length > 0) {
    existingList.forEach((item) => console.log(item));
  } else {
    console.log("(None)");
  }

  console.log("\nVerifying user statuses in database...");
  for (const userConfig of USERS_TO_CREATE) {
    const email = userConfig.email.toLowerCase().trim();
    const verifiedUser: IAdminUserDocument | null = await AdminUser.findOne({ email });
    if (!verifiedUser) {
      throw new Error(`Verification failed: User ${email} was not found in database.`);
    }
    if (verifiedUser.role !== TARGET_ROLE) {
      throw new Error(`Verification failed: User ${email} has role '${verifiedUser.role}', expected '${TARGET_ROLE}'.`);
    }
    console.log(`Verified: ${verifiedUser.email} (ID: ${verifiedUser._id}) -> role: ${verifiedUser.role}, active: ${verifiedUser.isActive}`);
  }

  await mongooseInstance.disconnect();
  console.log("\nDatabase disconnected. Super admin setup complete.");
}

main().catch((error: unknown) => {
  console.error("❌ Super admin creation script failed:", error);
  process.exit(1);
});
