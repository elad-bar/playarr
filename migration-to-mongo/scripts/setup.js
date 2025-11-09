import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Setup script to initialize .env file from .env.example
 */
async function setup() {
  const rootDir = path.resolve(__dirname, '..');
  const envExamplePath = path.join(rootDir, '.env.example');
  const envPath = path.join(rootDir, '.env');

  try {
    // Check if .env.example exists
    if (!(await fs.pathExists(envExamplePath))) {
      console.error('Error: .env.example file not found');
      process.exit(1);
    }

    // Check if .env already exists
    if (await fs.pathExists(envPath)) {
      console.log('.env file already exists. Skipping setup.');
      console.log('If you want to recreate it, delete .env and run npm run setup again.');
      return;
    }

    // Copy .env.example to .env
    await fs.copyFile(envExamplePath, envPath);
    console.log('✓ Created .env file from .env.example');
    console.log('⚠ Please edit .env file with your MongoDB connection details before running migration.');
  } catch (error) {
    console.error(`Error during setup: ${error.message}`);
    process.exit(1);
  }
}

// Run setup if executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('setup.js')) {
  setup();
}

export default setup;

