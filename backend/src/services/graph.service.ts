import prisma from '../db';

class GraphService {

  async getEntitiesByType(userId: string, type: string) {
    return prisma.entity.findMany({
      where: { userId, type },
    });
  }

  async getRelationships(userId: string, entityId: string) {
    return prisma.entityLink.findMany({
      where: {
        OR: [
          {
            entityId: entityId, // Where this entity is the subject
            subjectEntity: { userId: userId },
          },
          {
            objectId: entityId, // Where this entity is the object
            objectEntity: { userId: userId },
          },
        ],
      },
      include: {
        subjectEntity: true,
        objectEntity: true,
        memory: true,
        chatMessage: true,
      },
    });
  }

  async findRelatedEntities(userId: string, entityName: string, relationshipType: string) {
    const initialEntity = await prisma.entity.findFirst({
      where: { userId, name: entityName },
    });

    if (!initialEntity) {
      return [];
    }

    const relatedLinks = await prisma.entityLink.findMany({
      where: {
        entityId: initialEntity.id,
        role: relationshipType,
        subjectEntity: { userId: userId },
      },
      include: {
        subjectEntity: true,
        objectEntity: true,
        memory: true,
        chatMessage: true,
      },
    });

    return relatedLinks.map(link => ({
      subject: link.subjectEntity.name,
      predicate: link.role,
      object: link.objectEntity?.name, // objectEntity might be null if it's a memory link
      source: link.memory?.content || link.chatMessage?.content,
    }));
  }

  // More advanced methods would go here, e.g., for multi-hop queries
}

export const graphService = new GraphService();