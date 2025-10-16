import prisma from "./src/db";

async function queryMemory() {
  try {
    const memory = await prisma.memory.findUnique({
      where: { id: "f5bb5eaf-d9a5-4f97-8186-ec4858d6d78d" }
    });
    console.log(memory?.recordedAt?.toISOString());
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

queryMemory();
