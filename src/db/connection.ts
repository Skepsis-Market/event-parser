import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let client: MongoClient;
let db: Db;

export async function connectDB(): Promise<Db> {
  if (db) return db;
  
  const uri = process.env.MONGODB_URI!;
  const dbName = process.env.MONGODB_DB!;
  
  client = new MongoClient(uri);
  await client.connect();
  
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB: ${dbName}`);
  
  return db;
}

export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

export function getDB(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return db;
}
