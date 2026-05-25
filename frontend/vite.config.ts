import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/** Resolve chrome.exe / binary; returns null if unknown. */
function resolveChromeExecutable(): string | null {
  const { platform, env } = process;

  if (platform === "win32") {
    const candidates = [
      join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env.PROGRAMFILES || "", "Google", "Chrome Beta", "Application", "chrome.exe"),
      join(env.LOCALAPPDATA || "", "Google", "Chrome SxS", "Application", "chrome.exe"),
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    return null;
  }

  if (platform === "darwin") {
    const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return existsSync(p) ? p : null;
  }

  for (const p of [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]) {
    if (existsSync(p)) return p;
  }

  return null;
}

function openUrlInChrome(url: string) {
  const exe = resolveChromeExecutable();
  const { platform } = process;

  if (exe) {
    spawn(exe, [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "chrome", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  if (platform === "darwin") {
    spawn("open", ["-a", "Google Chrome", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

/** Always try to open the app in Google Chrome when the server is ready. */
function openChromeAlways(): Plugin {
  return {
    name: "open-chrome-always",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const port = server.config.server.port ?? 5173;
        const host = server.config.server.host === true ? "0.0.0.0" : server.config.server.host;
        const h =
          !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : String(host);
        const url = `http://${h}:${port}/`;
        setTimeout(() => openUrlInChrome(url), 450);
      });
    },
    configurePreviewServer(server) {
      server.httpServer?.once("listening", () => {
        const port =
          typeof server.config.preview.port === "number" ? server.config.preview.port : 4173;
        const host = server.config.preview.host;
        const h =
          !host || host === true || host === "0.0.0.0" || host === "::"
            ? "127.0.0.1"
            : String(host);
        const url = `http://${h}:${port}/`;
        setTimeout(() => openUrlInChrome(url), 450);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), openChromeAlways()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    open: false,
  },
});
