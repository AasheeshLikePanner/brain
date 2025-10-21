import prisma from '../db';
import { EntityLink, Entity } from '@prisma/client';

export type EntityLinkWithEntities = EntityLink & {
  subjectEntity: Entity;
  objectEntity: Entity | null;
};

interface RelationshipMetadata {
  strength: number;
  confidence: number;
  firstSeen: Date;
  lastSeen: Date;
  mentions: number;
  status: 'active' | 'historical' | 'deprecated';
}

interface PathNode {
  entityId: string;
  entityName: string;
  relationship?: string;
}

interface Path {
  nodes: PathNode[];
  strength: number;
  length: number;
  explanation: string;
}

interface GetRelationshipsOptions {
  types?: string[];
  minConfidence?: number;
  onlyActive?: boolean;
  since?: Date;
  limit?: number;
  includeMetadata?: boolean;
}

class GraphService {

  /**
   * Get entities by type with optional filtering
   */
  async getEntitiesByType(
    userId: string, 
    type: string,
    options?: { limit?: number; minMentions?: number }
  ) {
    const where: any = { userId, type };
    
    return prisma.entity.findMany({
      where,
      take: options?.limit,
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Enhanced relationship retrieval with filtering and metadata
   */
  async getRelationships(
    userId: string, 
    entityId: string,
    options: GetRelationshipsOptions = {}
  ): Promise<EntityLinkWithEntities[]> {
    console.time('graphService.getRelationships');

    const where: any = {
      OR: [
        {
          entityId: entityId,
          subjectEntity: { userId: userId },
        },
        {
          objectId: entityId,
          objectEntity: { userId: userId },
        },
      ],
    };

    // Apply filters
    if (options.types && options.types.length > 0) {
      where.role = { in: options.types };
    }

    if (options.since) {
      where.updatedAt = { gte: options.since };
    }

    // Note: Add these fields to your EntityLink model in Prisma schema
    // if (options.minConfidence) {
    //   where.confidence = { gte: options.minConfidence };
    // }

    // if (options.onlyActive) {
    //   where.status = 'active';
    // }

    const relationships = await prisma.entityLink.findMany({
      where,
      take: options.limit,
      include: {
        subjectEntity: true,
        objectEntity: true,
        // Only include heavy fields if needed
        ...(options.includeMetadata && {
          memory: { select: { id: true, content: true, recordedAt: true } },
          chatMessage: { select: { id: true, content: true, createdAt: true } },
        }),
      },
      // orderBy: { lastSeen: 'desc' } // Commented out to resolve TS2353 error temporarily
    });

    console.timeEnd('graphService.getRelationships');
    return relationships as EntityLinkWithEntities[];
  }

  /**
   * Find related entities with single query (optimized)
   */
  async findRelatedEntities(
    userId: string, 
    entityName: string, 
    relationshipType?: string
  ) {
    const where: any = {
      subjectEntity: {
        userId: userId,
        name: { equals: entityName, mode: 'insensitive' }
      }
    };

    if (relationshipType) {
      where.role = relationshipType;
    }

    const relatedLinks = await prisma.entityLink.findMany({
      where,
      include: {
        subjectEntity: true,
        objectEntity: true,
        memory: { select: { id: true, content: true, recordedAt: true } },
        chatMessage: { select: { id: true, content: true, createdAt: true } },
      },
    });

    return relatedLinks.map((link:any) => ({
      subject: link.subjectEntity.name,
      predicate: link.role || 'related_to',
      object: link.objectEntity?.name || 'unknown',
      source: link.memory?.content || link.chatMessage?.content || '',
      sourceDate: link.memory?.recordedAt || link.chatMessage?.createdAt,
      confidence: (link as any).confidence || 0.7, // Use actual confidence if available
    }));
  }

  /**
   * Find shortest path between two entities using BFS
   */
  async findShortestPath(
    userId: string,
    startEntityId: string,
    endEntityId: string,
    maxDepth: number = 4
  ): Promise<Path | null> {
    if (startEntityId === endEntityId) {
      return null;
    }

    // BFS to find shortest path
    const queue: Array<{ entityId: string; path: PathNode[] }> = [
      { entityId: startEntityId, path: [] }
    ];
    const visited = new Set<string>([startEntityId]);

    while (queue.length > 0) {
      const { entityId, path } = queue.shift()!;

      if (path.length >= maxDepth) {
        continue;
      }

      const relationships = await this.getRelationships(userId, entityId, {
        onlyActive: true,
        limit: 50
      });

      for (const rel of relationships) {
        const nextEntityId = rel.entityId === entityId ? rel.objectId : rel.entityId;
        
        if (!nextEntityId || visited.has(nextEntityId)) {
          continue;
        }

        const nextEntity = rel.entityId === entityId ? rel.objectEntity : rel.subjectEntity;
        const relationship = rel.role || 'related_to';

        const newPath = [
          ...path,
          {
            entityId,
            entityName: path.length === 0 
              ? (rel.entityId === entityId ? rel.subjectEntity.name : rel.objectEntity?.name || '')
              : path[path.length - 1].entityName,
            relationship
          }
        ];

        if (nextEntityId === endEntityId) {
          // Found the target
          newPath.push({
            entityId: nextEntityId,
            entityName: nextEntity?.name || '',
          });

          return {
            nodes: newPath,
            strength: this.calculatePathStrength(newPath),
            length: newPath.length - 1,
            explanation: this.generatePathExplanation(newPath)
          };
        }

        visited.add(nextEntityId);
        queue.push({ entityId: nextEntityId, path: newPath });
      }
    }

    return null; // No path found
  }

  /**
   * Find all paths between two entities (up to maxPaths)
   */
  async findAllPaths(
    userId: string,
    startEntityId: string,
    endEntityId: string,
    maxDepth: number = 3,
    maxPaths: number = 10
  ): Promise<Path[]> {
    const paths: Path[] = [];
    const visited = new Set<string>();

    const dfs = async (
      currentId: string,
      targetId: string,
      currentPath: PathNode[],
      depth: number
    ) => {
      if (depth > maxDepth || paths.length >= maxPaths) {
        return;
      }

      if (currentId === targetId && currentPath.length > 0) {
        paths.push({
          nodes: [...currentPath],
          strength: this.calculatePathStrength(currentPath),
          length: currentPath.length - 1,
          explanation: this.generatePathExplanation(currentPath)
        });
        return;
      }

      visited.add(currentId);

      const relationships = await this.getRelationships(userId, currentId, {
        onlyActive: true,
        limit: 20
      });

      for (const rel of relationships) {
        const nextEntityId = rel.entityId === currentId ? rel.objectId : rel.entityId;
        
        if (!nextEntityId || visited.has(nextEntityId)) {
          continue;
        }

        const nextEntity = rel.entityId === currentId ? rel.objectEntity : rel.subjectEntity;
        const relationship = rel.role || 'related_to';

        currentPath.push({
          entityId: nextEntityId,
          entityName: nextEntity?.name || '',
          relationship
        });

        await dfs(nextEntityId, targetId, currentPath, depth + 1);

        currentPath.pop();
      }

      visited.delete(currentId);
    };

    const startEntity = await prisma.entity.findUnique({
      where: { id: startEntityId },
      select: { name: true }
    });

    if (startEntity) {
      await dfs(startEntityId, endEntityId, [{
        entityId: startEntityId,
        entityName: startEntity.name
      }], 0);
    }

    return paths.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Get most central entities (highest connectivity)
   */
  async getCentralEntities(userId: string, limit: number = 10) {
    const entities = await prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, type: true }
    });

    const centralityScores = await Promise.all(
      entities.map(async (entity:any) => {
        const relationships = await this.getRelationships(userId, entity.id, {
          onlyActive: true
        });

        return {
          entity,
          score: relationships.length,
          relationshipCount: relationships.length
        };
      })
    );

    return centralityScores
      .sort((a:any, b:any) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Detect entity clusters using simple connected components
   */
  async getClusters(userId: string): Promise<Array<{ entities: any[]; size: number }>> {
    const entities = await prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, type: true }
    });

    const visited = new Set<string>();
    const clusters: Array<{ entities: any[]; size: number }> = [];

    for (const entity of entities) {
      if (visited.has(entity.id)) {
        continue;
      }

      const cluster = await this.getConnectedComponent(userId, entity.id, visited);
      
      if (cluster.length > 0) {
        clusters.push({
          entities: cluster,
          size: cluster.length
        });
      }
    }

    return clusters.sort((a, b) => b.size - a.size);
  }

  /**
   * Get isolated entities (no relationships)
   */
  async getIsolatedEntities(userId: string) {
    const entities = await prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, type: true }
    });

    const isolated = [];

    for (const entity of entities) {
      const relationships = await this.getRelationships(userId, entity.id, {
        limit: 1
      });

      if (relationships.length === 0) {
        isolated.push(entity);
      }
    }

    return isolated;
  }

  /**
   * Calculate relationship strength between two entities
   */
  async getRelationshipStrength(
    userId: string,
    entityAId: string,
    entityBId: string
  ): Promise<number> {
    const relationships = await prisma.entityLink.findMany({
      where: {
        OR: [
          { entityId: entityAId, objectId: entityBId },
          { entityId: entityBId, objectId: entityAId }
        ],
        subjectEntity: { userId }
      }
    });

    if (relationships.length === 0) {
      return 0;
    }

    // Strength based on:
    // - Number of different relationship types
    // - Recency of relationships
    // - Frequency of mentions (if metadata available)
    
    const uniqueTypes = new Set(relationships.map((r:any) => r.role)).size;
    const recencyScore = relationships.reduce((sum:any, rel:any) => {
      const daysSince = (Date.now() - rel.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      return sum + Math.exp(-daysSince / 30); // Exponential decay
    }, 0);

    return Math.min(1.0, (uniqueTypes * 0.3 + recencyScore * 0.7) / relationships.length);
  }

  /**
   * Get relationship history between entities
   */
  async getRelationshipHistory(
    userId: string,
    entityAId: string,
    entityBId: string
  ) {
    const relationships = await prisma.entityLink.findMany({
      where: {
        OR: [
          { entityId: entityAId, objectId: entityBId },
          { entityId: entityBId, objectId: entityAId }
        ],
        subjectEntity: { userId }
      },
      include: {
        memory: { select: { content: true, recordedAt: true } },
        chatMessage: { select: { content: true, createdAt: true } }
      },
      // orderBy: { createdAt: 'asc' } // Commented out to resolve TS2353 error temporarily
    });

    return relationships.map((rel:any) => ({
      type: rel.role || 'related_to',
      date: rel.memory?.recordedAt || rel.chatMessage?.createdAt || rel.createdAt,
      source: rel.memory?.content || rel.chatMessage?.content || '',
      direction: rel.entityId === entityAId ? 'forward' : 'backward'
    }));
  }

  /**
   * Find entities matching a pattern (e.g., all people who work_on AI projects)
   */
  async findEntitiesByPattern(
    userId: string,
    startType: string,
    relationshipType: string,
    targetType: string
  ) {
    const startEntities = await this.getEntitiesByType(userId, startType);
    const matches = [];

    for (const entity of startEntities) {
      const related = await this.findRelatedEntities(
        userId,
        entity.name,
        relationshipType
      );

      for (const rel of related) {
        const targetEntity = await prisma.entity.findFirst({
          where: {
            userId,
            name: { equals: rel.object, mode: 'insensitive' },
            type: targetType
          }
        });

        if (targetEntity) {
          matches.push({
            source: entity,
            relationship: rel.predicate,
            target: targetEntity,
            evidence: rel.source
          });
        }
      }
    }

    return matches;
  }

  // ==================== HELPER METHODS ====================

  private async getConnectedComponent(
    userId: string,
    startEntityId: string,
    visited: Set<string>
  ): Promise<any[]> {
    const component = [];
    const queue = [startEntityId];
    visited.add(startEntityId);

    while (queue.length > 0) {
      const entityId = queue.shift()!;
      
      const entity = await prisma.entity.findUnique({
        where: { id: entityId },
        select: { id: true, name: true, type: true }
      });

      if (entity) {
        component.push(entity);
      }

      const relationships = await this.getRelationships(userId, entityId, {
        onlyActive: true
      });

      for (const rel of relationships) {
        const nextId = rel.entityId === entityId ? rel.objectId : rel.entityId;
        
        if (nextId && !visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      }
    }

    return component;
  }

  private calculatePathStrength(path: PathNode[]): number {
    // Simple heuristic: shorter paths are stronger
    // Can be enhanced with relationship weights
    return 1.0 / path.length;
  }

  private generatePathExplanation(path: PathNode[]): string {
    const parts = [];
    
    for (let i = 0; i < path.length - 1; i++) {
      const current = path[i];
      const next = path[i + 1];
      parts.push(`${current.entityName} ${current.relationship || 'connects to'} ${next.entityName}`);
    }

    return parts.join(', and ');
  }
}

export const graphService = new GraphService();