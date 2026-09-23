import { createClient } from 'redis';

// Create and configure Redis client
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

// Connect lazily — a top-level await here hangs Next.js page-data collection
// during builds (and fails when no Redis is reachable at build time).
async function ensureConnected(): Promise<void> {
  if (!redisClient.isOpen) {
    await redisClient.connect().catch((err) => {
      console.warn('Redis connect failed (cache disabled):', (err as Error).message);
    });
  }
}

// Function to set a key-value pair in Redis
export const setValue = async (key: string, value: string): Promise<void> => {
  await ensureConnected();
  await redisClient.set(key, value);
};

// Function to retrieve a value by key from Redis
export const getValue = async (key: string): Promise<string | null> => {
  await ensureConnected();
  return redisClient.get(key);
};


export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    await redisClient.set('health', 'ok');
    const reply = await redisClient.get('health');
    return reply === 'ok';
  } catch (error) {
    console.error('Redis Health Check Failed:', error);
    return false;
  }
};
