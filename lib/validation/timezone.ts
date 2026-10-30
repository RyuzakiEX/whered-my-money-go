/**
 * IANA time zone validation, shared by every schema that accepts a zone.
 *
 * Not `Intl.supportedValuesOf('timeZone')`: that list is ICU's canonical set,
 * which differs between runtimes (Node 22 lists `Asia/Calcutta` but not
 * `Asia/Kolkata`, and omits `UTC`), so a browser and the server would
 * disagree. Not `Intl.DateTimeFormat` alone either: it accepts offsets such as
 * `+08:00`, and an offset is not a zone — it does not survive DST or a
 * legislative change (docs/architecture/data-model.md#profiles).
 */

/** An IANA name: letters first, `/`-separated segments, no offset prefix. */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** `GMT+8`, `UTC-05`: offsets dressed as names. `Etc/GMT+8` is a real zone. */
const OFFSET_NAME = /^(?:GMT|UTC)[+-]\d/i;

/**
 * The canonical spelling of an IANA zone (`asia/manila` → `Asia/Manila`), or
 * `null` when the value is not a zone this runtime knows.
 */
export function canonicalTimeZone(value: string): string | null {
  if (!IANA_SHAPE.test(value) || OFFSET_NAME.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
