import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});


console.log('[Prisma] PrismaClient instantiated.');

async function connectPrisma() {
  try {
    // Set a timeout for connection
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database connection timeout')), 10000);
    });
    
    await Promise.race([prisma.$connect(), timeoutPromise]);
    console.log('[Prisma] Connected to database.');
  } catch (e) {
    console.error('[Prisma] Could not connect to database:', e);
    process.exit(1);
  }
}

connectPrisma();

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
console.log('[Prisma] Prisma client exported.');
