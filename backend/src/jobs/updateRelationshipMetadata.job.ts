import prisma from '../db';

export async function updateRelationshipMetadata() {
  const links = await prisma.entityLink.findMany({
    where: { status: 'active' },
  });

  for (const link of links) {
    const subjectEntity = await prisma.entity.findUnique({
        where: { id: link.entityId },
        select: { name: true }
    });

    const objectEntity = link.objectId ? await prisma.entity.findUnique({
        where: { id: link.objectId },
        select: { name: true }
    }) : null;

    if (!subjectEntity) {
        continue;
    }

    // Find all memories mentioning this relationship
    const memories = await prisma.memory.findMany({
      where: {
        AND: [
          { content: { contains: subjectEntity.name } },
          { content: { contains: objectEntity?.name || '' } }
        ]
      }
    });

    // Update mentions count
    await prisma.entityLink.update({
      where: { id: link.id },
      data: {
        mentions: memories.length,
        lastSeen: memories[0]?.createdAt || new Date()
      }
    });
  }
}