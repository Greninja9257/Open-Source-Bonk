// Browser inspection helper; expressions run in the selected page.
const debugPort = process.env.BONK_DEBUG_PORT || '9339';
const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const selector = process.argv[2] || 'bonk.io';
const page = pages.find(page => page.type === 'page' && (page.id === selector || page.url.includes(selector)));
if (!page) throw new Error('Page not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const call = (method, params = {}) => new Promise(resolve => {
  const id = ++sequence;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
await call('Page.bringToFront');
const result = await call('Runtime.evaluate', { expression: process.argv[3] || 'document.title', returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(result.result || result.error, null, 2));
if (result.error || result.result?.exceptionDetails) {
  socket.close();
  throw new Error('Browser evaluation failed; screenshot was not captured.');
}
if (process.argv[4]) {
  const { writeFile } = await import('node:fs/promises');
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  if (!capture.result?.data) throw new Error(JSON.stringify(capture));
  await writeFile(process.argv[4], Buffer.from(capture.result.data, 'base64'));
}
socket.close();
