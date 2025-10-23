import { connectDB, closeDB } from './db/connection';

async function testConnection() {
  console.log('🔍 Testing MongoDB connection...\n');
  
  try {
    const db = await connectDB();
    
    // Test database operations
    const collections = await db.listCollections().toArray();
    console.log(`📁 Found ${collections.length} collections:`);
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });
    
    console.log('\n✅ MongoDB connection successful!');
    
    await closeDB();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

testConnection();
