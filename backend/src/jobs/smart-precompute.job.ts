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
  
  // Get popular entities for this user (from cache tracking)
  const popularEntities = await smartCacheService.getPopularEntities(userId, 20);
  
  if (popularEntities.length === 0) {
    console.log(`[SmartPrecomputeJob] No popular entities for user ${userId}`);
    return 0;
  }
  
  console.log(`[SmartPrecomputeJob] Found ${popularEntities.length} popular entities for user ${userId}`);
  
  let processed = 0;
  
  for (const { entityId, entityName } of popularEntities) {
    try {
      // Check if already cached
      const cached = await smartCacheService.getCachedInsights(entityName);
      
      if (cached) {
        console.log(`[SmartPrecomputeJob] ${entityName} already cached, skipping`);
        continue;
      }
      
      console.log(`[SmartPrecomputeJob] Computing insights for ${entityName}...`);
      
      // Get entity details
      const entity = await prisma.entity.findUnique({
        where: { id: entityId }
      });
      
      if (!entity) continue;

      // Fetch memories related to this entity separately
      const entityMemories = await prisma.memory.findMany({
        where: {
          userId,
          deleted: false,
          content: {
            contains: entity.name, // Assuming memories contain the entity name
            mode: 'insensitive'
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      });
      
      // Compute graph
      const relationships = await graphService.getRelationships(userId, entity.id);
      const graph = {
        entity: entity.name,
        relationships: relationships.map(r => ({
          subject: r.subjectEntity.name,
          predicate: r.role || 'related to',
          object: r.objectEntity?.name || 'unknown'
        }))
      };
      
      // Compute timeline if entity has memories
      let timeline = null;
      if (entityMemories.length > 0) {
        timeline = await reasoningService.buildTimeline(userId, entity.name);
      }
      
      // Cache the results
      const insights = {
        entityId: entity.id,
        entityName: entity.name,
        graph,
        timeline,
        cachedAt: Date.now()
      };
      
      const cacheKey = `insights:${entityName.toLowerCase()}`;
      await redis.setex(cacheKey, 3600, JSON.stringify(insights));
      
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

/**
 * Clean up old cache entries
 */
export async function cleanupCacheJob() {
  console.log('[CleanupCacheJob] Starting cache cleanup...');
  
  try {
    // Redis automatically expires keys with TTL, but we can clean up tracking
    const pattern = 'entity_usage:*';
    const keys = await redis.keys(pattern);
    
    let cleaned = 0;
    
    for (const key of keys) {
      const lastUsed = await redis.hget(key, 'lastUsed');
      
      if (lastUsed) {
        const daysSinceUsed = (Date.now() - parseInt(lastUsed)) / (1000 * 60 * 60 * 24);
        
        // Remove tracking for entities not used in 30 days
        if (daysSinceUsed > 30) {
          await redis.del(key);
          cleaned++;
        }
      }
    }
    
    console.log(`[CleanupCacheJob] Cleaned up ${cleaned} old tracking entries`);
    
  } catch (error) {
    console.error('[CleanupCacheJob] Error:', error);
  }
}