/**
 * Docker teardown for E2E tests
 * Stops Docker containers after running tests
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function globalTeardown() {
  console.log('Stopping Docker containers...');

  try {
    // Stop and remove containers
    await execAsync('docker-compose -f ../../docker-compose.web.yml down -v', {
      cwd: __dirname
    });

    console.log('Docker containers stopped successfully!');
  } catch (error) {
    console.error('Failed to stop Docker containers:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }
}

export default globalTeardown;
