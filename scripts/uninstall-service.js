if (process.platform === "darwin") {
  const { uninstallMac } = await import("./platform/mac.js");
  uninstallMac();
} else if (process.platform === "win32") {
  const { uninstallWindows } = await import("./platform/windows.js");
  uninstallWindows();
} else {
  console.error(`No automated uninstaller for platform "${process.platform}".`);
}
