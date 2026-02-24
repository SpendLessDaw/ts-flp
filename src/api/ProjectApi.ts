/**
 * High-level API for reading and modifying FL Studio project files
 * Provides typed access to project metadata, samples, plugins, and time info
 */

import { EVENT_ID } from "../generated/events.generated.js";
import { BinaryReader } from "../io/BinaryReader.js";
import { BinaryWriter } from "../io/BinaryWriter.js";
import {
  createNumberPayload,
  createTextPayload,
  findFirstEvent,
  type FlpEvent,
  getEventNumber,
  getEventString,
  type ParsedFlp,
  patchEvents,
} from "../parser/FlpParser.js";

// ============================================================================
// Project Metadata
// ============================================================================

/**
 * Project metadata (name, description, artist, genre, BPM)
 */
export interface ProjectMeta {
  name: string | null;
  description: string | null;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

/**
 * Reads project metadata from a parsed FLP
 */
export function readProjectMeta(parsed: ParsedFlp): ProjectMeta {
  const titleEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TITLE);
  const commentsEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_COMMENTS);
  const artistsEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_ARTISTS);
  const genreEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_GENRE);
  const tempoEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TEMPO);

  return {
    name: titleEvent ? getEventString(titleEvent, parsed.useUnicode) : null,
    description: commentsEvent ? getEventString(commentsEvent, parsed.useUnicode) : null,
    artist: artistsEvent ? getEventString(artistsEvent, parsed.useUnicode) : null,
    genre: genreEvent ? getEventString(genreEvent, parsed.useUnicode) : null,
    bpm: tempoEvent ? getEventNumber(tempoEvent) / 1000 : null,
  };
}

/**
 * Writes project metadata to a parsed FLP
 * Only modifies fields that are provided (non-undefined)
 */
export function writeProjectMeta(parsed: ParsedFlp, meta: Partial<ProjectMeta>): ParsedFlp {
  return patchEvents(parsed, (event: FlpEvent) => {
    // Patch title
    if (meta.name !== undefined && event.id === EVENT_ID.PROJECT_TITLE) {
      return {
        ...event,
        payload: createTextPayload(meta.name ?? "", parsed.useUnicode),
      };
    }

    // Patch comments/description
    if (meta.description !== undefined && event.id === EVENT_ID.PROJECT_COMMENTS) {
      return {
        ...event,
        payload: createTextPayload(meta.description ?? "", parsed.useUnicode),
      };
    }

    // Patch artists
    if (meta.artist !== undefined && event.id === EVENT_ID.PROJECT_ARTISTS) {
      return {
        ...event,
        payload: createTextPayload(meta.artist ?? "", parsed.useUnicode),
      };
    }

    // Patch genre
    if (meta.genre !== undefined && event.id === EVENT_ID.PROJECT_GENRE) {
      return {
        ...event,
        payload: createTextPayload(meta.genre ?? "", parsed.useUnicode),
      };
    }

    // Patch tempo (stored as BPM * 1000)
    if (meta.bpm && Math.abs(meta.bpm) > 0 && event.id === EVENT_ID.PROJECT_TEMPO) {
      return {
        ...event,
        payload: createNumberPayload(Math.round(Math.abs(meta.bpm) * 1000), "u32"),
      };
    }

    return event;
  });
}

// ============================================================================
// Project Time Info
// ============================================================================

/**
 * Project creation date and work time
 */
export interface ProjectTimeInfo {
  creationDate: Date | null;
  workTimeSeconds: number | null;
}

// Delphi epoch: December 30, 1899
const DELPHI_EPOCH = new Date(1899, 11, 30);

/**
 * Converts Delphi timestamp (days since epoch) to Date
 */
function delphiToDate(days: number): Date {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(DELPHI_EPOCH.getTime() + ms);
}

/**
 * Converts Date to Delphi timestamp (days since epoch)
 */
function dateToDelphiDays(date: Date): number {
  const ms = date.getTime() - DELPHI_EPOCH.getTime();
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * Reads project time info from a parsed FLP
 * Timestamp event contains: Float64 created_on (days), Float64 time_spent (days)
 */
export function readProjectTimeInfo(parsed: ParsedFlp): ProjectTimeInfo {
  const timestampEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TIMESTAMP);

  if (!timestampEvent || timestampEvent.payload.length < 16) {
    return {
      creationDate: null,
      workTimeSeconds: null,
    };
  }

  const reader = new BinaryReader(timestampEvent.payload);
  const createdOnDays = reader.readF64LE();
  const timeSpentDays = reader.readF64LE();

  return {
    creationDate: delphiToDate(createdOnDays),
    workTimeSeconds: timeSpentDays * 24 * 60 * 60, // Convert days to seconds
  };
}

/**
 * Writes project time info to a parsed FLP
 * Only modifies fields that are provided (non-undefined)
 * 
 * If `creationDate` or `workTimeSeconds` is set to `null`, the final value will be set on `0` (Delphi epoch)
 */
export function writeProjectTimeInfo(
  parsed: ParsedFlp,
  info: Partial<ProjectTimeInfo>
): ParsedFlp {
  // Read current values to preserve unmodified fields
  const current = readProjectTimeInfo(parsed);

  return patchEvents(parsed, (event: FlpEvent) => {
    if (event.id !== EVENT_ID.PROJECT_TIMESTAMP) {
      return event;
    }

    const writer = new BinaryWriter();

    // Write creation date
    if (info.creationDate !== undefined && info.creationDate !== null) {
      writer.writeF64LE(dateToDelphiDays(info.creationDate));
    } else if (current.creationDate !== null) {
      writer.writeF64LE(dateToDelphiDays(current.creationDate));
    } else {
      writer.writeF64LE(0);
    }

    // Write work time
    if (info.workTimeSeconds !== undefined && info.workTimeSeconds !== null) {
      writer.writeF64LE(info.workTimeSeconds / (24 * 60 * 60)); // Convert seconds to days
    } else if (current.workTimeSeconds !== null) {
      writer.writeF64LE(current.workTimeSeconds / (24 * 60 * 60));
    } else {
      writer.writeF64LE(0);
    }

    return {
      ...event,
      payload: writer.toBuffer(),
    };
  });
}

// ============================================================================
// Samples
// ============================================================================

/**
 * Reference to a sample in the project
 */
export interface SampleRef {
  /** Index of the event in the events array */
  eventIndex: number;
  /** File path of the sample */
  path: string;
}

/**
 * Lists all samples in the project
 */
export function listSamples(parsed: ParsedFlp): SampleRef[] {
  const samples: SampleRef[] = [];

  parsed.events.forEach((event: FlpEvent, index: number) => {
    if (event.id === EVENT_ID.CHANNEL_SAMPLE_PATH) {
      const path = getEventString(event, parsed.useUnicode);
      if (path && path.length > 0) {
        samples.push({
          eventIndex: index,
          path,
        });
      }
    }
  });

  return samples;
}

/**
 * Rewrites sample paths using a mapper function
 */
export function rewriteSamplePaths(
  parsed: ParsedFlp,
  mapper: (oldPath: string) => string
): ParsedFlp {
  return patchEvents(parsed, (event: FlpEvent) => {
    if (event.id !== EVENT_ID.CHANNEL_SAMPLE_PATH) {
      return event;
    }

    const oldPath = getEventString(event, parsed.useUnicode);
    if (!oldPath || oldPath.length === 0) {
      return event;
    }

    const newPath = mapper(oldPath);
    if (newPath === oldPath) {
      return event;
    }

    return {
      ...event,
      payload: createTextPayload(newPath, parsed.useUnicode),
    };
  });
}

// ============================================================================
// Plugins (VST)
// ============================================================================

/**
 * Reference to a plugin in the project
 */
export interface PluginRef {
  /** Plugin name (may be null if not available) */
  name: string | null;
  /** Plugin vendor/provider (may be null if not stored in file) */
  vendor: string | null;
}

/**
 * VST Plugin Event internal IDs (from plugin.py VSTPluginEvent)
 */
const VST_EVENT_ID = {
  MIDI: 1,
  FLAGS: 2,
  IO: 30,
  INPUTS: 31,
  OUTPUTS: 32,
  PLUGIN_INFO: 50,
  FOUR_CC: 51,
  GUID: 52,
  STATE: 53,
  NAME: 54,
  PLUGIN_PATH: 55,
  VENDOR: 56,
} as const;

/**
 * Parses a VST plugin data event to extract name and vendor
 * Based on VSTPluginEvent structure in PyFLP
 */
function parseVstPluginData(payload: Buffer): { name: string | null; vendor: string | null } {
  if (payload.length < 4) {
    return { name: null, vendor: null };
  }

  const reader = new BinaryReader(payload);

  // First 4 bytes: wrapper marker.
  // Historically seen values include 8/10/11, but newer FL versions can use
  // other markers (e.g. 12). We read and ignore the exact value here because
  // this parser is only called for "Fruity Wrapper" plugin data.
  const typeMarker = reader.readU32LE();
  void typeMarker;

  let name: string | null = null;
  let vendor: string | null = null;

  // Parse sub-events
  while (reader.remaining() >= 12) {
    // At minimum: 4 (id) + 8 (size)
    const subEventId = reader.readU32LE();
    const dataSize = reader.readU32LE(); // Lower 32 bits of size
    const dataSizeHigh = reader.readU32LE(); // Upper 32 bits (usually 0)

    // Combine for 64-bit size (though in practice it's always small)
    const actualSize = dataSize + dataSizeHigh * 0x100000000;

    if (actualSize > reader.remaining()) {
      break;
    }

    const data = reader.readBytes(actualSize);

    // Extract name and vendor
    if (subEventId === VST_EVENT_ID.NAME && actualSize > 0) {
      name = data.toString("utf8").replace(/\0/g, "");
    } else if (subEventId === VST_EVENT_ID.VENDOR && actualSize > 0) {
      vendor = data.toString("utf8").replace(/\0/g, "");
    }
  }

  return { name, vendor };
}

/**
 * Lists all plugins (VST and native) in the project
 * Returns plugin name and vendor where available
 */
export function listPlugins(parsed: ParsedFlp): PluginRef[] {
  const plugins: PluginRef[] = [];
  const seenPlugins = new Set<string>();

  // Track current channel context
  let currentInternalName: string | null = null;
  let currentPluginName: string | null = null;

  for (const event of parsed.events) {
    // Track channel new events as boundaries
    if (event.id === EVENT_ID.CHANNEL_NEW) {
      // Reset context for new channel
      if (currentInternalName || currentPluginName) {
        // Save previous channel's plugin if it wasn't a VST (no plugin data)
        const key = `${currentInternalName ?? ""}:${currentPluginName ?? ""}`;
        if (!seenPlugins.has(key) && currentInternalName && currentInternalName !== "Fruity Wrapper") {
          seenPlugins.add(key);
          plugins.push({
            name: currentPluginName || currentInternalName,
            vendor: null, // Native plugins don't store vendor
          });
        }
      }
      currentInternalName = null;
      currentPluginName = null;
    }

    // Track internal name (identifies plugin type)
    if (event.id === EVENT_ID.PLUGIN_INTERNAL_NAME) {
      currentInternalName = getEventString(event, parsed.useUnicode);
    }

    // Track display name
    if (event.id === EVENT_ID.PLUGIN_NAME) {
      currentPluginName = getEventString(event, parsed.useUnicode);
    }

    // Parse VST plugin data
    if (event.id === EVENT_ID.PLUGIN_DATA && currentInternalName === "Fruity Wrapper") {
      const vstData = parseVstPluginData(event.payload);
      if (vstData.name) {
        const key = `vst:${vstData.name}:${vstData.vendor ?? ""}`;
        if (!seenPlugins.has(key)) {
          seenPlugins.add(key);
          plugins.push({
            name: vstData.name,
            vendor: vstData.vendor,
          });
        }
      }
      // Reset context after processing VST
      currentInternalName = null;
      currentPluginName = null;
    }
  }

  // Handle last channel if any
  if (currentInternalName && currentInternalName !== "Fruity Wrapper") {
    const key = `${currentInternalName}:${currentPluginName ?? ""}`;
    if (!seenPlugins.has(key)) {
      plugins.push({
        name: currentPluginName || currentInternalName,
        vendor: null,
      });
    }
  }

  return plugins;
}

// ============================================================================
// FL Version
// ============================================================================

/**
 * Gets the FL Studio version string from the project
 */
export function getFlVersion(parsed: ParsedFlp): string {
  return parsed.flVersion;
}

/**
 * Gets the PPQ (Pulses Per Quarter note) from the header
 */
export function getPPQ(parsed: ParsedFlp): number {
  // PPQ is at offset 12-13 in the header (bytes 12-13 of the 14-byte FLhd chunk)
  const reader = new BinaryReader(parsed.headerChunkBytes);
  reader.seek(12);
  return reader.readU16LE();
}
