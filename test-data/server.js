const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  // CORS Headers for all responses
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const filename = data.filename || `dump-${Date.now()}.json`;
        delete data.filename;
        
        fs.writeFileSync(path.join(__dirname, filename), JSON.stringify(data, null, 2));
        console.log(`Saved ${filename}`);
        
        res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' });
        res.end('OK');
      } catch (e) {
        console.error('Error parsing JSON:', e);
        res.writeHead(400, headers);
        res.end('Error');
      }
    });
  } else if (req.method === 'GET' && req.url === '/extract.js') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/javascript' });
    res.end(fs.readFileSync(path.join(__dirname, 'extract.js')));
  } else if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
  } else {
    res.writeHead(404, headers);
    res.end('Not found');
  }
});

server.listen(3000, () => {
  console.log('Local extraction server listening on http://localhost:3000');
  console.log('Waiting for data from the browser console...');
});
