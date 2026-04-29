/**
 * TinyClaw watermark — optional signature appended to outgoing messages.
 *
 * Disabled by default. Enable by setting the environment variable:
 *   TINYCLAW_WATERMARK=1
 *
 * Works with both plain-text and HTML content types.
 */

const WATERMARK_TEXT = "\n\n— Sent via TinyClaw 🦞";
const WATERMARK_HTML = '<br><br><span style="color:#888;font-size:small">— Sent via TinyClaw 🦞</span>';

/** Returns true if the watermark feature is enabled via env var. */
export function isWatermarkEnabled(): boolean {
  const val = process.env.TINYCLAW_WATERMARK;
  return val === "1" || val === "true";
}

/**
 * Append the TinyClaw watermark to a message if enabled.
 * @param message  The original message content
 * @param isHtml   Whether the message is HTML (default: false → plain text)
 * @returns The message, possibly with watermark appended
 */
export function appendWatermark(message: string, isHtml = false): string {
  if (!isWatermarkEnabled()) return message;
  return message + (isHtml ? WATERMARK_HTML : WATERMARK_TEXT);
}
