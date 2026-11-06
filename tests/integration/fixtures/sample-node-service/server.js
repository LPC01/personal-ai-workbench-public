'use strict';

// 真实 Node HTTP 服务：供工作台「接入真实项目」演示。
// 无外部依赖，仅使用 node: 内置模块。
const http = require('node:http');

const port = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>示例 Node 服务</title></head><body>' +
      '<h1>示例 Node 服务</h1><p>这是一个由工作台托管运行的真实服务。</p>' +
      '<p>端口：' +
      port +
      '</p></body></html>',
  );
});

server.listen(port, '127.0.0.1', () => {
  console.log('sample-node-service listening on http://127.0.0.1:' + port);
});
