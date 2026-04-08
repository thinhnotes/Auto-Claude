/**
 * Docker setup for E2E tests
 * Starts Docker containers before running tests
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function globalSetup() {
  console.log('Starting Docker containers for E2E tests...');

  try {
    // Check if Docker is available
    await execAsync('docker --version');
    
    // Start Docker Compose
    await execAsync('docker-compose -f ../../docker-compose.web.yml up -d', {
      cwd: __dirname
    });

    // Wait for services to be healthy
    console.log('Waiting for services to be healthy...');
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      try {
        const { stdout } = await execAsync('docker-compose -f ../../docker-compose.web.yml ps --format json', {
          cwd: __dirname
        });

        const services = JSON.parse(stdout);
        const allHealthy = services.every((service: { Health: string }) => 
          service.Health === 'healthy' || !service.Health
        );

        if (allHealthy) {
          console.log('All services are healthy!');
          break;
        }
      } catch (error) {
        // Continue waiting
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (attempts >= maxAttempts) {
      throw new Error('Services did not become healthy in time');
    }

    // Additional wait for app initialization
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Docker containers are ready!');
  } catch (error) {
    console.error('Failed to start Docker containers:', error);
    throw error;
  }
}

export default globalSetup;
