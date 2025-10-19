import redis from '../queues/redis';
import prisma from '../db';
import { graphService } from './graph.service';
import { reasoningService } from './reasoning.service';

interface CachedInsight {
  entityId: string;
  entityName: string;
  graph?: any;
  timeline?: any;
  implications?: any;
  cachedAt: number;
}

class SmartCacheService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly POPULAR_ENTITY_THRESHOLD = 2; // Mentioned at least 2 times
  
  /**
   * Get cached insights for an entity (super fast lookup)
   */
  async getCachedInsights(entityName: string): Promise<CachedInsight | null> {
    try {
      const cacheKey = `insights:${entityName.toLowerCase()}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        console.log(`[SmartCache] HIT for entity: ${entityName}`);
        return JSON.parse(cached);
      }
      
      console.log(`[SmartCache] MISS for entity: ${entityName}`);
      return null;
    } catch (error) {
      console.error('[SmartCache] Error getting cached insights:', error);
      return null;
    }
  }
  
  /**
   * Lazy compute and cache insights for an entity
   * Only called when user asks about it and it's not cached
   */
  async lazyComputeAndCache(
    userId: string,
    entityName: string,
    needsGraph: boolean,
    needsTimeline: boolean
  ): Promise<CachedInsight> {
    console.log(`[SmartCache] Lazy computing insights for: ${entityName}`);
    
    // Find entity in database
    const entity = await prisma.entity.findFirst({
      where: {
        userId,
        name: {
          equals: entityName,
          mode: 'insensitive'
        }
      }
    });
    
    if (!entity) {
      console.log(`[SmartCache] Entity not found: ${entityName}`);
      return {
        entityId: '',
        entityName,
        cachedAt: Date.now()
      };
    }

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
    
    const insights: CachedInsight = {
      entityId: entity.id,
      entityName: entity.name,
      cachedAt: Date.now()
    };
    
    // Compute graph if needed
    if (needsGraph) {
      console.log(`[SmartCache] Computing graph for ${entityName}...`);
      const startTime = Date.now();
      
      const relationships = await graphService.getRelationships(userId, entity.id);
      insights.graph = {
        entity: entity.name,
        relationships: relationships.map(r => ({
          subject: r.subjectEntity.name,
          predicate: r.role || 'related to',
          object: r.objectEntity?.name || 'unknown'
        }))
      };
      
      console.log(`[SmartCache] Graph computed in ${Date.now() - startTime}ms`);
    }
    
    // Compute timeline if needed
    if (needsTimeline && entityMemories.length > 0) {
      console.log(`[SmartCache] Computing timeline for ${entityName}...`);
      const startTime = Date.now();
      
      insights.timeline = await reasoningService.buildTimeline(userId, entity.name);
      
      console.log(`[SmartCache] Timeline computed in ${Date.now() - startTime}ms`);
    }
    
    // Cache the results
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    debugger;
    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(insights));
    
    // Track this entity as "popular" for background jobs
    await this.trackEntityUsage(userId, entity.id, entityName);
    
    console.log(`[SmartCache] Cached insights for ${entityName}`);
    return insights;
  }
  
  /**
   * Track which entities users care about
   * Used by background job to know what to pre-compute
   */
  private async trackEntityUsage(
    userId: string,
    entityId: string,
    entityName: string
  ): Promise<void> {
    const trackingKey = `entity_usage:${userId}:${entityId}`;
    
    // Increment usage count
    await redis.hincrby(trackingKey, 'count', 1);
    await redis.hset(trackingKey, 'name', entityName);
    await redis.hset(trackingKey, 'lastUsed', Date.now().toString());
    
    // Keep tracking for 7 days
    await redis.expire(trackingKey, 7 * 24 * 60 * 60);
  }
  
  /**
   * Get popular entities for a user (used by background job)
   */
  async getPopularEntities(userId: string, limit: number = 20): Promise<Array<{
    entityId: string;
    entityName: string;
    usageCount: number;
  }>> {
    try {
      // Find all tracking keys for this user
      const pattern = `entity_usage:${userId}:*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length === 0) return [];
      
      // Get usage data for each entity
      const entities = await Promise.all(
        keys.map(async (key) => {
          const data = await redis.hgetall(key);
          const entityId = key.split(':')[2];
          
          return {
            entityId,
            entityName: data.name || '',
            usageCount: parseInt(data.count || '0', 10),
            lastUsed: parseInt(data.lastUsed || '0', 10)
          };
        })
      );
      
      // Filter entities used at least threshold times
      const popular = entities.filter(
        e => e.usageCount >= this.POPULAR_ENTITY_THRESHOLD
      );
      
      // Sort by usage count and recency
      popular.sort((a, b) => {
        // Prioritize by count first, then by recency
        if (b.usageCount !== a.usageCount) {
          return b.usageCount - a.usageCount;
        }
        return b.lastUsed - a.lastUsed;
      });
      
      return popular.slice(0, limit);
    } catch (error) {
      console.error('[SmartCache] Error getting popular entities:', error);
      return [];
    }
  }
  
  /**
   * Invalidate cache when entity is updated
   */
  async invalidateEntity(entityName: string): Promise<void> {
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    await redis.del(cacheKey);
    console.log(`[SmartCache] Invalidated cache for: ${entityName}`);
  }
}

export const smartCacheService = new SmartCacheService();