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
  
  async getCachedInsights(entityName: string): Promise<CachedInsight | null> {
    try {
      const cacheKey = `insights:${entityName.toLowerCase()}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  async lazyComputeAndCache(
    userId: string,
    entityName: string,
    needsGraph: boolean,
    needsTimeline: boolean
  ): Promise<CachedInsight> {
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
      return {
        entityId: '',
        entityName,
        cachedAt: Date.now()
      };
    }

    const entityMemories = await prisma.memory.findMany({
      where: {
        userId,
        deleted: false,
        content: {
          contains: entity.name,
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
    
    if (needsGraph) {
      const relationships = await graphService.getRelationships(userId, entity.id);
      insights.graph = {
        entity: entity.name,
        relationships: relationships.map(r => ({
          subject: r.subjectEntity.name,
          predicate: r.role || 'related to',
          object: r.objectEntity?.name || 'unknown'
        }))
      };
    }
    
    if (needsTimeline && entityMemories.length > 0) {
      insights.timeline = await reasoningService.buildTimeline(userId, entity.name);
    }
    
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(insights));
    
    await this.trackEntityUsage(userId, entity.id, entityName);
    
    return insights;
  }
  
  private async trackEntityUsage(
    userId: string,
    entityId: string,
    entityName: string
  ): Promise<void> {
    const trackingKey = `entity_usage:${userId}:${entityId}`;
    
    await redis.hincrby(trackingKey, 'count', 1);
    await redis.hset(trackingKey, 'name', entityName);
    await redis.hset(trackingKey, 'lastUsed', Date.now().toString());
    
    await redis.expire(trackingKey, 7 * 24 * 60 * 60);
  }
  
  async getPopularEntities(userId: string, limit: number = 20): Promise<Array<{
    entityId: string;
    entityName: string;
    usageCount: number;
  }>> {
    try {
      const pattern = `entity_usage:${userId}:*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length === 0) return [];
      
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
      
      const popular = entities.filter(
        e => e.usageCount >= this.POPULAR_ENTITY_THRESHOLD
      );
      
      popular.sort((a, b) => {
        if (b.usageCount !== a.usageCount) {
          return b.usageCount - a.usageCount;
        }
        return b.lastUsed - a.lastUsed;
      });
      
      return popular.slice(0, limit);
    } catch (error) {
      return [];
    }
  }
  
  async invalidateEntity(entityName: string): Promise<void> {
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    await redis.del(cacheKey);
  }
}

export const smartCacheService = new SmartCacheService();
