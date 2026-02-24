/**
 * FL Studio .flp file parser and serializer
 * Conservative patch approach: preserves all unknown data byte-for-byte
 *
 * Uses look-ahead scoring to handle events in the DWORD range (128-191)
 * that may use either fixed 4-byte encoding or VarInt-encoded variable
 * length payloads. For each unknown event in this range, both
 * interpretations are scored by parsing ahead ~200 bytes and counting
 * how many TEXT/DATA events (with valid VarInt sizes) are reachable.
 * The interpretation producing more valid TEXT/DATA events wins.
 */

import {
  DWORD,
  EVENT_ID,
  EVENT_KIND,
  TEXT,
  WORD,
  getEventKind,
} from '../generated/events.generated.js';
import { BinaryReader } from '../io/BinaryReader.js';
import { BinaryWriter } from '../io/BinaryWriter.js';

/** Event IDs in the DWORD range (128-191) that are explicitly mapped in EVENT_KIND. */
const KNOWN_DWORD_IDS: ReadonlySet<number> = new Set(
  Object.keys(EVENT_KIND)
    .map(Number)
    .filter((id) => id >= DWORD && id < TEXT),
);

/**
 * Represents a single event in an FLP file
 * Stores raw bytes to enable conservative patching
 */
export interface FlpEvent {
  /** Event ID (0-255) */
  id: number;
  /** Data type classification */
  kind: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32' | 'text' | 'data' | 'unknown';
  /** Original header bytes (ID + size for variable-length events) */
  header: Buffer;
  /** Event payload data */
  payload: Buffer;
}

/**
 * Represents a parsed FLP file
 * Contains all data needed for conservative round-trip
 */
export interface ParsedFlp {
  /** FLhd chunk (header) - 14 bytes total */
  headerChunkBytes: Buffer;
  /** FLdt chunk header (magic + size placeholder) - 8 bytes */
  fldtHeaderBytes: Buffer;
  /** All events from the FLdt chunk */
  events: FlpEvent[];
  /** Any trailing bytes after events (should be empty) */
  trailingBytes: Buffer | undefined;
  /** Detected FL version for string encoding */
  flVersion: string;
  /** Whether to use UTF-16LE for strings (FL >= 11.5) */
  useUnicode: boolean;
}

/**
 * Header structure constants
 */
const FLP_HEADER_MAGIC = 'FLhd';
const FLP_DATA_MAGIC = 'FLdt';
const FLP_HEADER_SIZE = 6; // Expected header chunk size
const LOOKAHEAD_BYTES = 200;
const LOOKAHEAD_VARINT_MAX = 100_000;

/**
 * Reads a VarInt directly from a raw buffer at the given offset.
 * Returns `{ size, bytesRead }` or `{ size: -1, bytesRead: 0 }` on failure.
 */
function readVarIntRaw(
  buf: Buffer,
  off: number,
  end: number,
): { size: number; bytesRead: number } {
  let shift = 0;
  let size = 0;
  const start = off;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (off >= end) return { size: -1, bytesRead: 0 };
    const byte = buf[off]!;
    off++;
    size |= (byte & 0x7f) << shift;
    shift += 7;
    if (!(byte & 0x80)) break;
  }
  return { size, bytesRead: off - start };
}

/**
 * Scores an alignment hypothesis by parsing ahead from `off` for up to
 * `bytesToCheck` bytes.  TEXT/DATA events with valid VarInt sizes are
 * the strongest signal of correct alignment; runs of low-value unknown
 * BYTE events (typical UTF-16-LE misread) are penalised.
 */
function scoreAlignment(buf: Buffer, off: number, end: number, bytesToCheck: number): number {
  const limit = Math.min(off + bytesToCheck, end);
  let textDataCount = 0;
  let consecutiveSmallByte = 0;
  let maxConsecutiveSmallByte = 0;

  while (off < limit) {
    const id = buf[off]!;

    if (id < WORD) {
      off += 2;
      if (id < 32 && !KNOWN_DWORD_IDS.has(id)) {
        consecutiveSmallByte++;
        maxConsecutiveSmallByte = Math.max(maxConsecutiveSmallByte, consecutiveSmallByte);
      } else {
        consecutiveSmallByte = 0;
      }
    } else if (id < DWORD) {
      off += 3;
      consecutiveSmallByte = 0;
    } else if (id < TEXT) {
      off += 5;
      consecutiveSmallByte = 0;
    } else {
      const vi = readVarIntRaw(buf, off + 1, end);
      if (vi.size >= 0 && vi.size < LOOKAHEAD_VARINT_MAX && off + 1 + vi.bytesRead + vi.size <= end) {
        textDataCount++;
        off = off + 1 + vi.bytesRead + vi.size;
      } else {
        return -100;
      }
      consecutiveSmallByte = 0;
    }
  }

  return textDataCount * 10 - maxConsecutiveSmallByte * 3;
}

/**
 * Parses an FL Studio project file
 *
 * @param buffer - Raw file data
 * @returns Parsed FLP structure
 * @throws Error if file is corrupted or invalid
 */
export function parseFlp(buffer: Buffer): ParsedFlp {
  const reader = new BinaryReader(buffer);

  // Read FLhd header chunk
  const headerMagic = reader.readBytes(4).toString('ascii');
  if (headerMagic !== FLP_HEADER_MAGIC) {
    throw new Error(`Invalid header magic: expected 'FLhd', got '${headerMagic}'`);
  }

  const headerSize = reader.readU32LE();
  if (headerSize !== FLP_HEADER_SIZE) {
    throw new Error(`Invalid header size: expected ${FLP_HEADER_SIZE}, got ${headerSize}`);
  }

  const format = reader.readI16LE();
  const channelCount = reader.readU16LE();
  const ppq = reader.readU16LE();

  // Validate format (0 = normal project)
  if (format < -1 || format > 0x50) {
    throw new Error(`Invalid file format: ${format}`);
  }

  // Store complete header chunk (14 bytes)
  const headerChunkBytes = buffer.subarray(0, 14);

  // Read FLdt data chunk header
  const dataMagic = reader.readBytes(4).toString('ascii');
  if (dataMagic !== FLP_DATA_MAGIC) {
    throw new Error(`Invalid data magic: expected 'FLdt', got '${dataMagic}'`);
  }

  const eventsSize = reader.readU32LE();

  // Validate events size
  const expectedFileSize = 22 + eventsSize; // 14 (FLhd) + 8 (FLdt header) + events
  if (buffer.length !== expectedFileSize) {
    throw new Error(
      `Data chunk size mismatch: expected file size ${expectedFileSize}, got ${buffer.length}`,
    );
  }

  // Store FLdt header (8 bytes)
  const fldtHeaderBytes = buffer.subarray(14, 22);

  // Parse events
  const events: FlpEvent[] = [];
  let flVersion = '0.0.0';
  let useUnicode = false;

  const eventsStart = reader.tell();
  const eventsEnd = eventsStart + eventsSize;

  while (reader.tell() < eventsEnd) {
    const eventStart = reader.tell();
    const eventId = reader.readU8();

    let payloadSize: number;
    let headerSize: number;

    if (eventId < WORD) {
      payloadSize = 1;
      headerSize = 1;
    } else if (eventId < DWORD) {
      payloadSize = 2;
      headerSize = 1;
    } else if (eventId < TEXT) {
      if (KNOWN_DWORD_IDS.has(eventId)) {
        payloadSize = 4;
        headerSize = 1;
      } else {
        // Unknown DWORD-range event: use look-ahead to decide encoding
        const afterDword = eventStart + 1 + 4;
        const vi = readVarIntRaw(buffer, eventStart + 1, eventsEnd);

        if (vi.size < 0 || vi.size > LOOKAHEAD_VARINT_MAX || eventStart + 1 + vi.bytesRead + vi.size > eventsEnd) {
          payloadSize = 4;
          headerSize = 1;
        } else if (vi.size === 3) {
          // VarInt(3) produces the same total footprint as DWORD; prefer DWORD
          payloadSize = 4;
          headerSize = 1;
        } else {
          const afterVarInt = eventStart + 1 + vi.bytesRead + vi.size;
          const dwordScore = scoreAlignment(buffer, afterDword, eventsEnd, LOOKAHEAD_BYTES);
          const varIntScore = scoreAlignment(buffer, afterVarInt, eventsEnd, LOOKAHEAD_BYTES);

          if (varIntScore > dwordScore + 2) {
            payloadSize = vi.size;
            reader.seek(eventStart + 1 + vi.bytesRead);
            headerSize = 1 + vi.bytesRead;
          } else {
            payloadSize = 4;
            headerSize = 1;
          }
        }
      }
    } else {
      // TEXT / DATA: always VarInt-encoded size
      const sizeStart = reader.tell();
      payloadSize = reader.readVarInt();
      headerSize = 1 + (reader.tell() - sizeStart);
    }

    const payload = reader.readBytes(payloadSize);
    const header = buffer.subarray(eventStart, eventStart + headerSize);
    const kind = getEventKind(eventId);

    const event: FlpEvent = {
      id: eventId,
      kind,
      header: Buffer.from(header),
      payload: Buffer.from(payload),
    };

    events.push(event);

    // Detect FL version from the first FLVersion event
    if (eventId === EVENT_ID.PROJECT_FL_VERSION && flVersion === '0.0.0') {
      const candidate = payload.toString('ascii').replace(/\0/g, '').trim();
      if (/^\d+(\.\d+)+$/.test(candidate)) {
        flVersion = candidate;
        const parts = flVersion.split('.').map((p) => parseInt(p, 10));
        const major = parts[0] ?? 0;
        const minor = parts[1] ?? 0;
        useUnicode = parts.length >= 2 && (major > 11 || (major === 11 && minor >= 5));
      }
    }
  }

  // Check for trailing bytes
  let trailingBytes: Buffer | undefined;
  if (reader.remaining() > 0) {
    trailingBytes = reader.readBytes(reader.remaining());
  }

  return {
    headerChunkBytes: Buffer.from(headerChunkBytes),
    fldtHeaderBytes: Buffer.from(fldtHeaderBytes),
    events,
    trailingBytes,
    flVersion,
    useUnicode,
  };
}

/**
 * Serializes a parsed FLP back to a buffer
 * Recalculates FLdt chunk size if events have changed
 *
 * @param parsed - Parsed FLP structure
 * @returns Serialized buffer
 */
export function serializeFlp(parsed: ParsedFlp): Buffer {
  const writer = new BinaryWriter();

  // Write FLhd header chunk (preserved byte-for-byte)
  writer.writeBytes(parsed.headerChunkBytes);

  // Calculate total events size
  let eventsSize = 0;
  for (const event of parsed.events) {
    eventsSize += serializeEvent(event).length;
  }

  // Add trailing bytes if present
  if (parsed.trailingBytes) {
    eventsSize += parsed.trailingBytes.length;
  }

  // Write FLdt header with updated size
  writer.writeBytes(Buffer.from(FLP_DATA_MAGIC, 'ascii'));
  writer.writeU32LE(eventsSize);

  // Write all events
  for (const event of parsed.events) {
    writer.writeBytes(serializeEvent(event));
  }

  // Write trailing bytes if present
  if (parsed.trailingBytes) {
    writer.writeBytes(parsed.trailingBytes);
  }

  return writer.toBuffer();
}

/**
 * Serializes a single event to bytes.
 *
 * For unchanged events the original header is emitted verbatim, ensuring a
 * byte-identical round-trip.  For newly created events (empty header) the
 * header is rebuilt: TEXT/DATA events get a VarInt-encoded size prefix,
 * BYTE/WORD/DWORD events get only the 1-byte ID.
 */
function serializeEvent(event: FlpEvent): Buffer {
  const writer = new BinaryWriter();

  if (event.header.length > 0) {
    writer.writeBytes(event.header);
  } else {
    writer.writeU8(event.id);
    if (event.id >= TEXT) {
      writer.writeVarInt(event.payload.length);
    }
  }

  writer.writeBytes(event.payload);

  return writer.toBuffer();
}

/**
 * Creates a new event with the given ID and payload.
 *
 * For TEXT/DATA events (id >= 192) the header includes a VarInt size prefix.
 * For BYTE/WORD/DWORD events the header is a single byte (the event ID).
 */
export function createEvent(id: number, payload: Buffer): FlpEvent {
  const kind = getEventKind(id);

  const headerWriter = new BinaryWriter();
  headerWriter.writeU8(id);

  if (id >= TEXT) {
    headerWriter.writeVarInt(payload.length);
  }

  return {
    id,
    kind,
    header: headerWriter.toBuffer(),
    payload: Buffer.from(payload),
  };
}

/**
 * Applies a patcher function to all events
 * Returns a new ParsedFlp with patched events
 *
 * @param parsed - Original parsed FLP
 * @param patcher - Function that transforms each event
 * @returns New ParsedFlp with patched events
 */
export function patchEvents(
  parsed: ParsedFlp,
  patcher: (event: FlpEvent, index: number) => FlpEvent,
): ParsedFlp {
  const patchedEvents = parsed.events.map((event, index) => {
    const patched = patcher(event, index);

    // If payload changed and the original event used a VarInt-encoded header
    // (header > 1 byte), recalculate the header with the new size.
    if (patched.payload !== event.payload && event.header.length > 1) {
      const headerWriter = new BinaryWriter();
      headerWriter.writeU8(patched.id);
      headerWriter.writeVarInt(patched.payload.length);
      return {
        ...patched,
        header: headerWriter.toBuffer(),
      };
    }

    return patched;
  });

  return {
    ...parsed,
    events: patchedEvents,
  };
}

/**
 * Finds all events with a specific ID
 */
export function findEvents(parsed: ParsedFlp, eventId: number): FlpEvent[] {
  return parsed.events.filter((e) => e.id === eventId);
}

/**
 * Finds the first event with a specific ID
 */
export function findFirstEvent(parsed: ParsedFlp, eventId: number): FlpEvent | undefined {
  return parsed.events.find((e) => e.id === eventId);
}

/**
 * Gets event payload as a string (handles encoding)
 */
export function getEventString(event: FlpEvent, useUnicode: boolean): string {
  if (event.kind !== 'text') {
    throw new Error(`Event ${event.id} is not a text event`);
  }

  if (useUnicode) {
    const str = event.payload.toString('utf16le');
    const nullPos = str.indexOf('\0');
    return nullPos === -1 ? str : str.substring(0, nullPos);
  } else {
    const str = event.payload.toString('ascii');
    const nullPos = str.indexOf('\0');
    return nullPos === -1 ? str : str.substring(0, nullPos);
  }
}

/**
 * Creates a text payload with proper encoding
 */
export function createTextPayload(text: string, useUnicode: boolean): Buffer {
  if (useUnicode) {
    return Buffer.from(text + '\0', 'utf16le');
  } else {
    return Buffer.from(text + '\0', 'ascii');
  }
}

/**
 * Gets event payload as a number
 */
export function getEventNumber(event: FlpEvent): number {
  const reader = new BinaryReader(event.payload);

  switch (event.kind) {
    case 'u8':
      return reader.readU8();
    case 'i8':
      return reader.readI8();
    case 'u16':
      return reader.readU16LE();
    case 'i16':
      return reader.readI16LE();
    case 'u32':
      return reader.readU32LE();
    case 'i32':
      return reader.readI32LE();
    case 'f32':
      return reader.readF32LE();
    default:
      throw new Error(`Cannot get number from ${event.kind} event`);
  }
}

/**
 * Creates a numeric payload
 */
export function createNumberPayload(
  value: number,
  kind: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32',
): Buffer {
  const writer = new BinaryWriter();

  switch (kind) {
    case 'u8':
      writer.writeU8(value);
      break;
    case 'i8':
      writer.writeI8(value);
      break;
    case 'u16':
      writer.writeU16LE(value);
      break;
    case 'i16':
      writer.writeI16LE(value);
      break;
    case 'u32':
      writer.writeU32LE(value);
      break;
    case 'i32':
      writer.writeI32LE(value);
      break;
    case 'f32':
      writer.writeF32LE(value);
      break;
  }

  return writer.toBuffer();
}
