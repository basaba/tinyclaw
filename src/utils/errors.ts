export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class CopilotError extends BridgeError {
  constructor(message: string, code = "COPILOT_ERROR") {
    super(message, code);
    this.name = "CopilotError";
  }
}

export class MemoryError extends BridgeError {
  constructor(message: string, code = "MEMORY_ERROR") {
    super(message, code);
    this.name = "MemoryError";
  }
}

export class ConfigError extends BridgeError {
  constructor(message: string, code = "CONFIG_ERROR") {
    super(message, code);
    this.name = "ConfigError";
  }
}
