/**
 * Cross-mode file picker.
 *
 * In Electron we use the native `dialog.showOpenDialog` exposed by the
 * preload script. In a browser there is no native dialog, so we render
 * a `DirectoryPickerModal` that walks the server's filesystem.
 */
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { DirectoryPickerModal } from "../components/DirectoryPickerModal";

export interface PickFileOptions {
  defaultPath?: string;
  extensions?: string[];
}

const DEFAULT_EXTS = ["yaml", "yml"];

function isElectron(): boolean {
  // Electron preload sets this to a real implementation; the browser
  // shim sets pickFile to a warning stub. Detect by user agent instead.
  return typeof navigator !== "undefined" &&
    /Electron/i.test(navigator.userAgent);
}

export function pickFile(opts: PickFileOptions = {}): Promise<string | null> {
  if (isElectron()) {
    return window.api.pickFile({ defaultPath: opts.defaultPath });
  }
  return openBrowserPicker(opts);
}

function openBrowserPicker(opts: PickFileOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);

    const cleanup = () => {
      try { root?.unmount(); } catch {}
      root = null;
      try { container.remove(); } catch {}
    };

    const handleSelect = (filePath: string) => {
      cleanup();
      resolve(filePath);
    };

    const handleClose = () => {
      cleanup();
      resolve(null);
    };

    root.render(
      <DirectoryPickerModal
        initialPath={opts.defaultPath}
        extensions={opts.extensions ?? DEFAULT_EXTS}
        onSelect={handleSelect}
        onClose={handleClose}
      />,
    );
  });
}
