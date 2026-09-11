const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[db] MONGODB_URI not set - running without persistence');
    return false;
  }
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    connected = true;
    console.log('[db] connected to MongoDB ->', mongoose.connection.name);
    await dropSingleAccountIndexes();
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    console.warn('[db] continuing without persistence (live WhatsApp data still works)');
    connected = false;
  }
  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('[db] disconnected');
  });
  mongoose.connection.on('connected', () => {
    connected = true;
  });
  return connected;
}

/**
 * The single-account schema made msgId, chatId and contactId globally unique.
 * With several accounts linked those ids legitimately repeat - the same message
 * seen by two of your numbers, the same contact in two address books - so the
 * old indexes would reject the second account's rows. Mongoose creates the new
 * compound indexes but never drops superseded ones, so do it here.
 */
async function dropSingleAccountIndexes() {
  const stale = {
    wamessages: 'msgId_1',
    wachats: 'chatId_1',
    wacontacts: 'contactId_1',
  };
  for (const [collection, indexName] of Object.entries(stale)) {
    try {
      const coll = mongoose.connection.db.collection(collection);
      const indexes = await coll.indexes();
      const found = indexes.find((i) => i.name === indexName && i.unique);
      if (!found) continue;
      await coll.dropIndex(indexName);
      console.log(`[db] dropped single-account index ${collection}.${indexName}`);
    } catch (e) {
      // A missing collection or index is the normal case on a fresh database.
      if (e.codeName !== 'IndexNotFound' && e.codeName !== 'NamespaceNotFound') {
        console.warn(`[db] could not drop ${collection}.${indexName}:`, e.message);
      }
    }
  }
}

const isConnected = () => connected && mongoose.connection.readyState === 1;

module.exports = { connectDB, isConnected, mongoose };
