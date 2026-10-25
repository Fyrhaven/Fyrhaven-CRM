// A throwaway server for the http:proxy spike: one endpoint, no user data.
//
//   node scripts/mock-server.mjs 8787
//
// Then set the plugin's server to http://localhost:8787 (see src/lib/remote.js)
// and run "Check the server" from the command palette. This is what the real
// server will look like before it does anything worth keeping.
import { createServer } from 'node:http';

const port = Number(process.argv[2]) || 8787;
const version = '0.1.0-mock';

const server = createServer((request, response) => {
  const send = (code, body) => {
    response.writeHead(code, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.method === 'GET' && request.url === '/version') {
    send(200, { version, name: 'contact-manager-server' });
    return;
  }
  send(404, { error: 'not found' });
});

server.listen(port, () => {
  console.log(`mock server on http://localhost:${port} — GET /version -> { version: '${version}' }`);
});
