import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.pitTask.findMany({
    where: {
      appointment: {
        status: 'Picking & Verification'
      }
    }
  });

  for (const task of tasks) {
    if (task.type !== 'Pick') {
      await prisma.pitTask.update({
        where: { id: task.id },
        data: { type: 'Pick' }
      });
      console.log(`Updated PitTask ${task.id} to type 'Pick'`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
