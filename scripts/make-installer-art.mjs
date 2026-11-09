// Draws the Windows installer's sidebar (164x314, welcome and finish pages) and header (150x57, the other pages) from
// build/icon.svg into build/installer-sidebar.bmp and build/installer-header.bmp: the 24-bit BMPs NSIS needs.
// Run with Electron when the icon or colours change: `npx electron scripts/make-installer-art.mjs`.
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
const icon = 'data:image/svg+xml;base64,' + readFileSync('build/icon.svg').toString('base64');
const font = "font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;box-sizing:border-box";
const ART = {
  'build/installer-sidebar.bmp': [164, 314, `<body style="margin:0;width:164px;height:314px;padding-top:34px;background:linear-gradient(#174d80,#0e3459);color:#fff;${font}">
    <img src="${icon}" style="display:block;width:96px;height:96px;margin:0 auto 14px">
    <div style="text-align:center;font-size:19px;font-weight:600;line-height:1.2">Borehole<br>Field Log</div>
    <div style="width:32px;height:3px;background:#ead08c;margin:14px auto"></div>
    <div style="text-align:center;font-size:11px;line-height:1.4;color:#c9d8e8;padding:0 14px">Borehole logging, groundwater and reporting</div></body>`],
  'build/installer-header.bmp': [150, 57, `<body style="margin:0;width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;gap:8px;${font}">
    <div style="font-size:11px;font-weight:600;color:#174d80;text-align:right;line-height:1.2">Borehole<br>Field Log</div>
    <img src="${icon}" style="width:46px;height:46px;margin-right:6px"></body>`],
};

// 24-bit bottom-up BMP from Chromium's BGRA bitmap, each row padded to 4 bytes
function bmp(w, h, bgra) {
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = 54 + (h - 1 - y) * row + x * 3;
    b[d] = bgra[s]; b[d + 1] = bgra[s + 1]; b[d + 2] = bgra[s + 2];
  }
  return b;
}

app.on('window-all-closed', () => {});   // stay open between the two drawings
app.whenReady().then(async () => {
  for (const [file, [w, h, html]] of Object.entries(ART)) {
    const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 300));   // let the icon decode
    const img = (await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })).resize({ width: w, height: h });
    writeFileSync(file, bmp(w, h, img.toBitmap()));
    console.log(file, `${w}x${h}`);
    win.destroy();
  }
  app.quit();
});
