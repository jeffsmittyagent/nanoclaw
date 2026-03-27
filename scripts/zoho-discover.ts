#!/usr/bin/env tsx
/**
 * Discovers your Zoho Invoice org ID, projects, and tasks.
 * Run: npx tsx scripts/zoho-discover.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env
const envPath = resolve(process.cwd(), '.env');
const envVars: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
}

const CLIENT_ID = envVars['ZOHO_CLIENT_ID'];
const CLIENT_SECRET = envVars['ZOHO_CLIENT_SECRET'];
const REFRESH_TOKEN = envVars['ZOHO_REFRESH_TOKEN'];

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Missing ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, or ZOHO_REFRESH_TOKEN in .env');
  process.exit(1);
}

// Step 1: Get a fresh access token
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: 'http://localhost:8085/callback',
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    body: params,
  });
  const data = (await res.json()) as Record<string, string>;
  if (data.error || !data.access_token) {
    console.error('Failed to get access token:', JSON.stringify(data, null, 2));
    console.error('\nDebug — request params sent:');
    console.error('  grant_type: refresh_token');
    console.error('  client_id:', CLIENT_ID);
    console.error('  refresh_token:', REFRESH_TOKEN.slice(0, 20) + '...');
    process.exit(1);
  }
  return data.access_token;
}

// Step 2: Get organizations
async function getOrgs(token: string) {
  const res = await fetch('https://www.zohoapis.com/invoice/v3/organizations', {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  return (await res.json()) as { organizations?: Array<{ organization_id: string; name: string }> };
}

// Step 3: Get projects for an org
async function getProjects(token: string, orgId: string) {
  const res = await fetch('https://www.zohoapis.com/invoice/v3/projects?per_page=100', {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'X-com-zoho-invoice-organizationid': orgId,
    },
  });
  return (await res.json()) as { projects?: Array<{ project_id: string; project_name: string; status: string }> };
}

// Step 4: Get tasks for a project
async function getTasks(token: string, orgId: string, projectId: string) {
  const res = await fetch(`https://www.zohoapis.com/invoice/v3/projects/${projectId}/tasks?per_page=100`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'X-com-zoho-invoice-organizationid': orgId,
    },
  });
  return (await res.json()) as { task?: Array<{ task_id: string; task_name: string }> };
}

// Main
console.log('Fetching access token...');
const token = await getAccessToken();
console.log('Token OK.\n');

console.log('Fetching organizations...');
const orgsData = await getOrgs(token);
const orgs = orgsData.organizations ?? [];

if (orgs.length === 0) {
  console.error('No organizations found.');
  process.exit(1);
}

for (const org of orgs) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ORG: ${org.name}`);
  console.log(`  org_id: ${org.organization_id}`);
  console.log('='.repeat(60));

  const projectsData = await getProjects(token, org.organization_id);
  const projects = projectsData.projects ?? [];

  if (projects.length === 0) {
    console.log('  No projects found.');
    continue;
  }

  for (const project of projects) {
    console.log(`\n  PROJECT: ${project.project_name} [${project.status}]`);
    console.log(`    project_id: ${project.project_id}`);

    const tasksData = await getTasks(token, org.organization_id, project.project_id);
    const tasks = tasksData.task ?? [];

    if (tasks.length === 0) {
      console.log('    (no tasks)');
    } else {
      for (const task of tasks) {
        console.log(`    TASK: ${task.task_name}`);
        console.log(`      task_id: ${task.task_id}`);
      }
    }
  }
}

console.log('\nDone.');
