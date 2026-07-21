const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spectemusDesktop", {
  getRuntimeStatus: () => ipcRenderer.invoke("spectemus:runtime-status"),
  onRuntimeStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("spectemus:runtime-status", wrapped);
    return () =>
      ipcRenderer.removeListener("spectemus:runtime-status", wrapped);
  },
});
