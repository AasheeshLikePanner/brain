import { Redis } from 'ioredis';

const redis = new Redis({
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  host: process.env.REDIS_HOST || 'localhost',
  maxRetriesPerRequest: null, // Recommended for BullMQ
});

redis.on('connect', () => console.log('Connected to Redis'));
redis.on('error', (err) => console.error('Redis Client Error', err));

export default redis;
