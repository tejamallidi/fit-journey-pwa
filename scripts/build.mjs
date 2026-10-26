import { mkdir, copyFile } from 'node:fs/promises';
const files = ['index.html', 'app.js', 'manifest.webmanifest', 'sw.js', 'icon.svg'];
await mkdir('public', { recursive: true });
for (const name of files) await copyFile(name, 'public/' + name);
console.log('Built static assets:', files.join(', '));
