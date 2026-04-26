import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the module by importing it and checking values match the current platform.
// On CI this runs on the actual OS; locally it validates the Windows branch.

describe("platform", () => {
  const isWin = process.platform === "win32";

  // Dynamic import so we can describe behaviour per-platform
  let platform: typeof import("../../src/tui/scheduler/platform.js");

  beforeEach(async () => {
    platform = await import("../../src/tui/scheduler/platform.js");
  });

  describe("IS_WINDOWS", () => {
    it("matches the current platform", () => {
      expect(platform.IS_WINDOWS).toBe(isWin);
    });
  });

  describe("SOCKET_PATH", () => {
    if (isWin) {
      it("returns a Windows named pipe path", () => {
        expect(platform.SOCKET_PATH).toBe("\\\\.\\pipe\\tinyclaw-daemon");
      });
    } else {
      it("returns a Unix socket path ending in daemon.sock", () => {
        expect(platform.SOCKET_PATH).toMatch(/daemon\.sock$/);
      });
    }
  });

  describe("CONFIG_DIR", () => {
    if (isWin) {
      it("lives under APPDATA on Windows", () => {
        const appdata = process.env.APPDATA;
        if (appdata) {
          expect(platform.CONFIG_DIR).toContain("tinyclaw");
          expect(platform.CONFIG_DIR.toLowerCase().startsWith(appdata.toLowerCase())).toBe(true);
        }
      });
    } else {
      it("lives under ~/.config on Unix", () => {
        expect(platform.CONFIG_DIR).toMatch(/\.config[\\/]tinyclaw$/);
      });
    }
  });

  describe("PID_FILE", () => {
    it("lives inside CONFIG_DIR", () => {
      expect(platform.PID_FILE).toContain(platform.CONFIG_DIR);
      expect(platform.PID_FILE).toMatch(/daemon\.pid$/);
    });
  });

  describe("isProcessRunning", () => {
    it("returns true for the current process", () => {
      expect(platform.isProcessRunning(process.pid)).toBe(true);
    });

    it("returns false for a non-existent PID", () => {
      // PID 99999999 is extremely unlikely to exist
      expect(platform.isProcessRunning(99999999)).toBe(false);
    });
  });

  describe("cleanupSocket", () => {
    it("does not throw even when no socket exists", () => {
      expect(() => platform.cleanupSocket()).not.toThrow();
    });
  });

  describe("ensureConfigDir", () => {
    it("does not throw", () => {
      expect(() => platform.ensureConfigDir()).not.toThrow();
    });
  });
});
