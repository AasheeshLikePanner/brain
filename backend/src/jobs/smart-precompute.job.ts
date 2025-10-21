import prisma from '../db';
import { smartCacheService } from '../services/smart-cache.service';
import { graphService } from '../services/graph.service';
import { reasoningService } from '../services/reasoning.service';
import redis from '../queues/redis';

/**
 * Smart pre-computation job
 * Only computes insights for entities users actually care about
 * Runs every hour
 */
export async function smartPrecomputeJob() {
  console.log('[SmartPrecomputeJob] Starting...');
  const startTime = Date.now();
  
  try {
    // Get all active users (users who had activity in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const activeUsers = await prisma.user.findMany({
      where: {
        chats: {
          some: {
            messages: {
              some: {
                createdAt: { gte: sevenDaysAgo }
              }
            }
          }
        }
      },
      select: { id: true }
    });
    
    console.log(`[SmartPrecomputeJob] Found ${activeUsers.length} active users`);
    
    let totalEntitiesProcessed = 0;
    
    // Process each active user
    for (const user of activeUsers) {
      const processed = await precomputeForUser(user.id);
      totalEntitiesProcessed += processed;
    }
    
    const duration = Date.now() - startTime;
    console.log(`[SmartPrecomputeJob] Completed in ${duration}ms`);
    console.log(`[SmartPrecomputeJob] Processed ${totalEntitiesProcessed} entities`);
    
  } catch (error) {
    console.error('[SmartPrecomputeJob] Error:', error);
  }
}

/**
 * Pre-compute insights for a specific user's popular entities
 */
async function precomputeForUser(userId: string): Promise<number> {
  console.log(`[SmartPrecomputeJob] Processing user ${userId}`);
  
  // Get popular entities for this user
  const popularEntities = await smartCacheService.getPopularEntities(userId, 20);
  
  if (popularEntities.length === 0) {
    console.log(`[SmartPrecomputeJob] No popular entities for user ${userId}`);
    return 0;
  }
  
  console.log(`[SmartPrecomputeJob] Found ${popularEntities.length} popular entities for user ${userId}`);
  
  let processed = 0;
  
  for (const { entityName } of popularEntities) {
    try {
      // Check if already cached
      const cached = await smartCacheService.getCachedInsights(entityName);
      
      if (cached) {
        console.log(`[SmartPrecomputeJob] ${entityName} already cached, skipping`);
        continue;
      }
      
      console.log(`[SmartPrecomputeJob] Computing insights for ${entityName}...`);
      
      // Use the lazy compute and cache function to pre-compute the insights
      await smartCacheService.lazyComputeAndCache(userId, entityName, true, true);
      
      console.log(`[SmartPrecomputeJob] Cached insights for ${entityName}`);
      processed++;
      
      // Small delay to avoid overloading
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`[SmartPrecomputeJob] Error processing ${entityName}:`, error);
    }
  }
  
  return processed;
}
