import { app, BrowserWindow } from 'electron';
import path from 'node:path';
const isDev = !app.isPackaged;
const createWindow = async () => {
    const window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1200,
        minHeight: 800,
        backgroundColor: '#020617',
        webPreferences: {
            contextIsolation: true,
            sandbox: true
        }
    });
    if (isDev) {
        await window.loadURL('http://localhost:5173');
        return;
    }
    await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
};
app.whenReady().then(() => {
    void createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
//# sourceMappingURL=main.js.map