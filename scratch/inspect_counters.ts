import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";

async function inspectCounters() {
  await connectMongoDB();
  const counters = await mongoose.connection.db!.collection('counters').find().toArray();
  console.log("Counters in DB:");
  console.log(JSON.stringify(counters, null, 2));
  await mongoose.disconnect();
}
inspectCounters();
