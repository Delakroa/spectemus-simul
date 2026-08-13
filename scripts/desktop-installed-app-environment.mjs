import { win32 } from "node:path";

/**
 * Installer собирается в MSYS2, где PATH содержит /mingw64/bin. Если
 * оставить его при smoke, недоукомплектованный ffmpeg.exe запустится
 * за счёт DLL с runner-а. В этом окружении Windows видит только каталог
 * проверяемого sidecar и свои системные каталоги.
 */
export function createIsolatedWindowsProbeEnvironment(
  filePath,
  environment = process.env,
) {
  const isolated = { ...environment };
  for (const key of Object.keys(isolated)) {
    if (key.toLowerCase() === "path") {
      delete isolated[key];
    }
  }

  const systemRoot =
    environment.SystemRoot ?? environment.SYSTEMROOT ?? "C:\\Windows";
  isolated.Path = [
    win32.dirname(filePath),
    win32.join(systemRoot, "System32"),
    systemRoot,
  ].join(win32.delimiter);
  return isolated;
}
