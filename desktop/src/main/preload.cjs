const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spectemusDesktop", {
  getRuntimeStatus: () => ipcRenderer.invoke("spectemus:runtime-status"),
  getPublicInviteOrigin: () =>
    ipcRenderer.invoke("spectemus:public-invite-origin"),
  pickMediaFile: () => ipcRenderer.invoke("spectemus:pick-media-file"),
  normalizeMedia: (id) => ipcRenderer.invoke("spectemus:normalize-media", id),
  cancelMediaNormalization: (id) =>
    ipcRenderer.invoke("spectemus:cancel-media-normalization", id),
  releaseMedia: (id) => ipcRenderer.invoke("spectemus:release-media", id),
  restartRuntime: () => ipcRenderer.invoke("spectemus:restart-runtime"),
  selectLanAddress: (address) =>
    ipcRenderer.invoke("spectemus:select-lan-address", address),
  onRuntimeStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on("spectemus:runtime-status", wrapped);
    return () =>
      ipcRenderer.removeListener("spectemus:runtime-status", wrapped);
  },
  onMediaNormalizationProgress: (listener) => {
    const wrapped = (_event, progress) => listener(progress);
    ipcRenderer.on("spectemus:media-normalization-progress", wrapped);
    return () =>
      ipcRenderer.removeListener(
        "spectemus:media-normalization-progress",
        wrapped,
      );
  },
});
