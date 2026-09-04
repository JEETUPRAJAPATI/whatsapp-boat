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

const isConnected = () => connected && mongoose.connection.readyState === 1;

module.exports = { connectDB, isConnected, mongoose };
