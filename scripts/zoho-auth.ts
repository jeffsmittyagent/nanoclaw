#!/usr/bin/env tsx
/**
 * One-time Zoho OAuth2 authorization flow.
 * Starts a local server on port 8085, opens the Zoho auth page in your browser,
 * catches the callback, exchanges the code for tokens, and prints the refresh token.
 *
 * Run: npx tsx scripts/zoho-auth.ts
 */

import http from 'http';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency needed)
const envPath = resolve(process.cwd(), '.env');
const envVars: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
}

const CLIENT_ID = envVars['ZOHO_CLIENT_ID'];
const CLIENT_SECRET = envVars['ZOHO_CLIENT_SECRET'];
const REDIRECT_URI = 'http://localhost:8085/callback';
const SCOPES = [
  'ZohoInvoice.settings.READ',
  'ZohoInvoice.projects.READ',
  'ZohoInvoice.projects.CREATE',
  'ZohoInvoice.projects.UPDATE',
  'ZohoInvoice.projects.DELETE',
].join(',');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET in .env');
  process.exit(1);
}

const authUrl =
  `https://accounts.zoho.com/oauth/v2/auth` +
  `?scope=${encodeURIComponent(SCOPES)}` +
  `&client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&access_type=offline`;

console.log('\nOpening Zoho authorization page in your browser...');
console.log('If it does not open automatically, visit:\n');
console.log(authUrl + '\n');

exec(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:8085');
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Authorization failed. Check the terminal for details.</h2>');
    console.error('Authorization error:', error || 'no code returned');
    server.close();
    return;
  }

  console.log('Authorization code received. Exchanging for tokens...\n');

  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    body: params,
  });

  const data = (await tokenRes.json()) as Record<string, string>;

  if (data.error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Token exchange failed. Check the terminal.</h2>');
    console.error('Token exchange error:', data);
    server.close();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>Success! You can close this tab. Check your terminal.</h2>');

  console.log('='.repeat(60));
  console.log('SUCCESS — add this to your .env file:\n');
  console.log(`ZOHO_REFRESH_TOKEN=${data.refresh_token}`);
  console.log('='.repeat(60));
  console.log(`\nAccess token (expires in 1 hour, don't store this):`);
  console.log(data.access_token);

  server.close();
});

server.listen(8085, () => {
  console.log('Waiting for Zoho callback on http://localhost:8085/callback ...');
});
