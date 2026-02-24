/**
 * FL Studio .flp file parser and serializer
 * Conservative patch approach: preserves all unknown data byte-for-byte
 */

import { DWORD, EVENT_ID, TEXT, WORD, getEventKind } from "../generated/events.generated.js";
import { BinaryReader } from "../io/BinaryReader.js";
import { BinaryWriter } from "../io/BinaryWriter.js";

/**
 * Represents a single event in an FLP file
 * Stores raw bytes to enable conservative patching
 */
export interface FlpEvent {
  /** Event ID (0-255) */
  id: number;
  /** Data type classification */
  kind: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32" | "text" | "data" | "unknown";
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
const FLP_HEADER_MAGIC = "FLhd";
const FLP_DATA_MAGIC = "FLdt";
const FLP_HEADER_SIZE = 6; // Expected header chunk size

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
  const headerMagic = reader.readBytes(4).toString("ascii");
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
  const dataMagic = reader.readBytes(4).toString("ascii");
  if (dataMagic !== FLP_DATA_MAGIC) {
    throw new Error(`Invalid data magic: expected 'FLdt', got '${dataMagic}'`);
  }

  const eventsSize = reader.readU32LE();

  // Validate events size
  const expectedFileSize = 22 + eventsSize; // 14 (FLhd) + 8 (FLdt header) + events
  if (buffer.length !== expectedFileSize) {
    throw new Error(
      `Data chunk size mismatch: expected file size ${expectedFileSize}, got ${buffer.length}`
    );
  }

  // Store FLdt header (8 bytes)
  const fldtHeaderBytes = buffer.subarray(14, 22);

  // Parse events
  const events: FlpEvent[] = [];
  let flVersion = "0.0.0";
  let useUnicode = false;
  let detectedVersion = false;

  const eventsStart = reader.tell();
  const eventsEnd = eventsStart + eventsSize;

  while (reader.tell() < eventsEnd) {
    const eventStart = reader.tell();
    const eventId = reader.readU8();

    let payloadSize: number;
    let headerSize: number;

    // Determine payload size based on event ID range
    if (eventId < WORD) {
      // BYTE range: 1 byte payload
      payloadSize = 1;
      headerSize = 1; // Just the ID
    } else if (eventId < DWORD) {
      // WORD range: 2 bytes payload
      payloadSize = 2;
      headerSize = 1;
    } else if (eventId < TEXT) {
      // DWORD range: 4 bytes payload
      payloadSize = 4;
      headerSize = 1;
    } else {
      // TEXT/DATA range: VarInt-encoded size
      const sizeStart = reader.tell();
      payloadSize = reader.readVarInt();
      headerSize = 1 + (reader.tell() - sizeStart); // ID + VarInt bytes
    }

    // Read payload
    const payload = reader.readBytes(payloadSize);

    // Extract header from original buffer for byte-perfect round-trip
    const header = buffer.subarray(eventStart, eventStart + headerSize);

    // Determine event kind
    const kind = getEventKind(eventId);

    const event: FlpEvent = {
      id: eventId,
      kind,
      header: Buffer.from(header),
      payload: Buffer.from(payload),
    };

    events.push(event);

    // Detect FL version from FLVersion event
    if (eventId === EVENT_ID.PROJECT_FL_VERSION && !detectedVersion) {
      const candidate = payload.toString("ascii").replace(/\0/g, "").trim();
      const isSemverLike = /^\d+(\.\d+)+$/.test(candidate);
      if (isSemverLike) {
        flVersion = candidate;
        const parts = flVersion.split(".").map((p) => parseInt(p, 10));
        const major = parts[0] ?? 0;
        const minor = parts[1] ?? 0;
        useUnicode = parts.length >= 2 && (major > 11 || (major === 11 && minor >= 5));
        detectedVersion = true;
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
  writer.writeBytes(Buffer.from(FLP_DATA_MAGIC, "ascii"));
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
 * Serializes a single event to bytes
 * Uses original header for unchanged events, recalculates for modified ones
 */
function serializeEvent(event: FlpEvent): Buffer {
  const writer = new BinaryWriter();

  // Conservative mode: preserve the original header bytes whenever available.
  // This keeps unchanged files byte-identical, including exact VarInt encoding.
  if (event.header.length > 0) {
    writer.writeBytes(event.header);
  } else {
    writer.writeU8(event.id);
    if (event.id >= TEXT) {
      writer.writeVarInt(event.payload.length);
    }
  }

  // Write payload
  writer.writeBytes(event.payload);

  return writer.toBuffer();
}

/**
 * Creates a new event with the given ID and payload
 */
export function createEvent(id: number, payload: Buffer): FlpEvent {
  const kind = getEventKind(id);

  // Build header
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
  patcher: (event: FlpEvent, index: number) => FlpEvent
): ParsedFlp {
  const patchedEvents = parsed.events.map((event, index) => {
    const patched = patcher(event, index);

    // If payload changed, recalculate header for TEXT/DATA events
    if (patched.payload !== event.payload && patched.id >= TEXT) {
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
  if (event.kind !== "text") {
    throw new Error(`Event ${event.id} is not a text event`);
  }

  if (useUnicode) {
    const str = event.payload.toString("utf16le");
    const nullPos = str.indexOf("\0");
    return nullPos === -1 ? str : str.substring(0, nullPos);
  } else {
    const str = event.payload.toString("ascii");
    const nullPos = str.indexOf("\0");
    return nullPos === -1 ? str : str.substring(0, nullPos);
  }
}

/**
 * Creates a text payload with proper encoding
 */
export function createTextPayload(text: string, useUnicode: boolean): Buffer {
  if (useUnicode) {
    return Buffer.from(text + "\0", "utf16le");
  } else {
    return Buffer.from(text + "\0", "ascii");
  }
}

/**
 * Gets event payload as a number
 */
export function getEventNumber(event: FlpEvent): number {
  const reader = new BinaryReader(event.payload);

  switch (event.kind) {
    case "u8":
      return reader.readU8();
    case "i8":
      return reader.readI8();
    case "u16":
      return reader.readU16LE();
    case "i16":
      return reader.readI16LE();
    case "u32":
      return reader.readU32LE();
    case "i32":
      return reader.readI32LE();
    case "f32":
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
  kind: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32"
): Buffer {
  const writer = new BinaryWriter();

  switch (kind) {
    case "u8":
      writer.writeU8(value);
      break;
    case "i8":
      writer.writeI8(value);
      break;
    case "u16":
      writer.writeU16LE(value);
      break;
    case "i16":
      writer.writeI16LE(value);
      break;
    case "u32":
      writer.writeU32LE(value);
      break;
    case "i32":
      writer.writeI32LE(value);
      break;
    case "f32":
      writer.writeF32LE(value);
      break;
  }

  return writer.toBuffer();
}
