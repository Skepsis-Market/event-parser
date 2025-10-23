import { Db } from 'mongodb';

/**
 * Initialize database collections and indexes
 */
export async function initializeCollections(db: Db): Promise<void> {
  console.log('🔧 Initializing collections and indexes...');

  // Create trades collection with validation
  try {
    await db.createCollection('trades', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['user', 'market_id', 'action', 'range', 'shares', 'amount', 'tx_hash'],
          properties: {
            user: { bsonType: 'string' },
            market_id: { bsonType: 'string' },
            action: { enum: ['BUY', 'SELL', 'CLAIM'] },
            range: {
              bsonType: 'object',
              required: ['start', 'end'],
              properties: {
                start: { bsonType: 'long' },
                end: { bsonType: 'long' }
              }
            },
            shares: { bsonType: 'long' },
            amount: { bsonType: 'long' },
            tx_hash: { bsonType: 'string' }
          }
        }
      }
    });
    console.log('  ✓ Created trades collection');
  } catch (error: any) {
    if (error.code === 48) {
      console.log('  ℹ trades collection already exists');
    } else {
      throw error;
    }
  }

  // Create positions collection
  try {
    await db.createCollection('positions');
    console.log('  ✓ Created positions collection');
  } catch (error: any) {
    if (error.code === 48) {
      console.log('  ℹ positions collection already exists');
    } else {
      throw error;
    }
  }

  // Create indexer_state collection
  try {
    await db.createCollection('indexer_state');
    console.log('  ✓ Created indexer_state collection');
  } catch (error: any) {
    if (error.code === 48) {
      console.log('  ℹ indexer_state collection already exists');
    } else {
      throw error;
    }
  }

  // Create indexes for trades
  console.log('🔧 Creating indexes for trades...');
  await db.collection('trades').createIndex({ tx_hash: 1 }, { unique: true });
  console.log('  ✓ tx_hash unique index');
  
  await db.collection('trades').createIndex({ user: 1, market_id: 1 });
  console.log('  ✓ user + market_id compound index');
  
  await db.collection('trades').createIndex({ market_id: 1 });
  console.log('  ✓ market_id index');
  
  await db.collection('trades').createIndex({ timestamp: -1 });
  console.log('  ✓ timestamp index');

  // Create indexes for positions
  console.log('🔧 Creating indexes for positions...');
  await db.collection('positions').createIndex(
    {
      user: 1,
      market_id: 1,
      'range.start': 1,
      'range.end': 1
    },
    { unique: true }
  );
  console.log('  ✓ unique position index');
  
  await db.collection('positions').createIndex({ user: 1 });
  console.log('  ✓ user index');
  
  await db.collection('positions').createIndex({ market_id: 1 });
  console.log('  ✓ market_id index');

  console.log('✅ Database initialization complete!');
}
