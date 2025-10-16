
import { ProactiveService } from './src/services/proactive.service';
import prisma from './src/db';

async function runProactiveService() {
  console.log('Manually triggering proactive service...');

  const user = await prisma.user.findFirst();

  if (!user) {
    console.error('No user found in the database to test with.');
    return;
  }

  console.log(`Testing for user: ${user.id}`);

  const proactiveService = new ProactiveService();
  const alerts = await proactiveService.generateProactiveAlerts(user.id);

  if (alerts.length === 0) {
    console.log('No proactive alerts were generated.');
  } else {
    console.log('Generated Alerts:');
    console.log(JSON.stringify(alerts, null, 2));

    console.log('\n--- Formatted Alerts ---');
    const formattedAlerts = proactiveService.formatAlertsForDisplay(alerts);
    console.log(formattedAlerts);
  }
}

runProactiveService()
  .catch(e => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

