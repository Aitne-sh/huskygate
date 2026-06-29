import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createDashboardServer } from '../src/dashboard/server.js';

const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const server = createDashboardServer({
  port: 3838,
  version: '0.1.0-preview',
  dataDir,
  serverApiPort: 3738,
  serverApiSecret: 'preview-secret',
  dashboardSecret: 'preview',
  workdirRoot: process.cwd(),
});

console.log('Preview dashboard: http://localhost:3838/?token=preview');
