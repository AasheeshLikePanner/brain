import redis from '../queues/redis';
import prisma from '../db';
import { graphService, EntityLinkWithEntities } from './graph.service';
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

    const insights: CachedInsight = {
      entityId: entity.id,
      entityName: entity.name,
      cachedAt: Date.now()
    };
    
    if (needsGraph) {
      const relationships = await graphService.getRelationships(userId, entity.id, { limit: 50 }) as EntityLinkWithEntities[];
      insights.graph = {
        entity: entity.name,
        relationships: relationships.map(r => ({
          subject: r.subjectEntity.name,
          predicate: r.role || 'related to',
          object: r.objectEntity?.name || 'unknown'
        }))
      };
    }
    
    if (needsTimeline) {
      insights.timeline = await reasoningService.buildTimeline(userId, entity.name);
    }
    
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(insights));
    
    return insights;
  }
  
  async getPopularEntities(userId: string, limit: number = 20): Promise<Array<{
    entityId: string;
    entityName: string;
    usageCount: number;
  }>> {
    try {
      const centralEntities = await graphService.getCentralEntities(userId, limit);
      
      return centralEntities.map(e => ({
        entityId: e.entity.id,
        entityName: e.entity.name,
        usageCount: e.relationshipCount
      }));
      
    } catch (error) {
      console.error('Error getting popular entities:', error);
      return [];
    }
  }
  
  async invalidateEntity(entityName: string): Promise<void> {
    const cacheKey = `insights:${entityName.toLowerCase()}`;
    await redis.del(cacheKey);
  }
}

export const smartCacheService = new SmartCacheService();
