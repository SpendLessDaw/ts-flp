/**
 * High-level API for reading and modifying FL Studio project files
 * Provides typed access to project metadata, samples, plugins, and time info
 */

import { EVENT_ID } from '../generated/events.generated.js';
import { BinaryReader } from '../io/BinaryReader.js';
import { BinaryWriter } from '../io/BinaryWriter.js';
import {
  createEvent,
  createNumberPayload,
  createTextPayload,
  findFirstEvent,
  type FlpEvent,
  getEventNumber,
  getEventString,
  type ParsedFlp,
  patchEvents,
} from '../parser/FlpParser.js';

const PROJECT_EVENT_ORDER = [
  EVENT_ID.PROJECT_TEMPO,
  EVENT_ID.PROJECT_TITLE,
  EVENT_ID.PROJECT_GENRE,
  EVENT_ID.PROJECT_ARTISTS,
  EVENT_ID.PROJECT_COMMENTS,
  EVENT_ID.PROJECT_TIMESTAMP,
] as const;

/** Inserts a project-level event without moving any existing event. */
function insertProjectEvent(parsed: ParsedFlp, event: FlpEvent): ParsedFlp {
  const orderIndex = PROJECT_EVENT_ORDER.indexOf(event.id as (typeof PROJECT_EVENT_ORDER)[number]);

  let insertionIndex = -1;
  if (orderIndex >= 0) {
    const laterIds = new Set<number>(PROJECT_EVENT_ORDER.slice(orderIndex + 1));
    insertionIndex = parsed.events.findIndex((candidate) => laterIds.has(candidate.id));

    if (insertionIndex < 0) {
      const previousIds = new Set<number>(PROJECT_EVENT_ORDER.slice(0, orderIndex + 1));
      for (let index = parsed.events.length - 1; index >= 0; index--) {
        if (previousIds.has(parsed.events[index]!.id)) {
          insertionIndex = index + 1;
          break;
        }
      }
    }
  }

  if (insertionIndex < 0) {
    insertionIndex = parsed.events.findIndex((candidate) => candidate.id === EVENT_ID.CHANNEL_NEW);
  }

  if (insertionIndex < 0) {
    const versionIndex = parsed.events.findIndex(
      (candidate) => candidate.id === EVENT_ID.PROJECT_FL_VERSION,
    );
    insertionIndex = versionIndex >= 0 ? versionIndex + 1 : parsed.events.length;
  }

  const events = [...parsed.events];
  events.splice(insertionIndex, 0, event);
  return { ...parsed, events };
}

function replaceEventPayload(parsed: ParsedFlp, target: FlpEvent, payload: Buffer): ParsedFlp {
  return patchEvents(parsed, (event) => (event === target ? { ...event, payload } : event));
}

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
 * Reads the BPM value from the parsed FLP.
 *
 * Primary: PROJECT_TEMPO (DWORD+28) stores BPM × 1000 as u32.
 * Legacy fallback: _TEMPO_COARSE (WORD+2) + _TEMPO_FINE (WORD+29).
 */
function readBpm(parsed: ParsedFlp): number | null {
  const tempoEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TEMPO);
  if (tempoEvent) {
    return getEventNumber(tempoEvent) / 1000;
  }

  const coarseEvent = findFirstEvent(parsed, EVENT_ID.PROJECT__TEMPO_COARSE);
  if (coarseEvent) {
    let bpm = coarseEvent.payload.readUInt16LE(0);
    const fineEvent = findFirstEvent(parsed, EVENT_ID.PROJECT__TEMPO_FINE);
    if (fineEvent) {
      bpm += fineEvent.payload.readUInt16LE(0) / 1000;
    }
    return bpm;
  }

  return null;
}

/**
 * Reads project metadata from a parsed FLP
 */
export function readProjectMeta(parsed: ParsedFlp): ProjectMeta {
  const titleEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TITLE);
  const commentsEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_COMMENTS);
  const artistsEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_ARTISTS);
  const genreEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_GENRE);

  return {
    name: titleEvent ? getEventString(titleEvent, parsed.useUnicode) : null,
    description: commentsEvent ? getEventString(commentsEvent, parsed.useUnicode) : null,
    artist: artistsEvent ? getEventString(artistsEvent, parsed.useUnicode) : null,
    genre: genreEvent ? getEventString(genreEvent, parsed.useUnicode) : null,
    bpm: readBpm(parsed),
  };
}

function compareVersion(version: string, expected: readonly number[]): number {
  const actual = version.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(actual.length, expected.length);

  for (let index = 0; index < length; index++) {
    const difference = (actual[index] ?? 0) - (expected[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  return 0;
}

function validateBpm(parsed: ParsedFlp, bpm: number): void {
  if (!Number.isFinite(bpm)) {
    throw new RangeError('BPM must be a finite number');
  }

  const legacyHighTempo =
    compareVersion(parsed.flVersion, [1, 4, 2]) >= 0 && compareVersion(parsed.flVersion, [11]) < 0;
  const maximum = legacyHighTempo ? 999 : 522;

  if (bpm < 10 || bpm > maximum) {
    throw new RangeError(`BPM must be between 10 and ${maximum} for FL Studio ${parsed.flVersion}`);
  }

  if (
    parsed.flVersion !== '0.0.0' &&
    compareVersion(parsed.flVersion, [3, 4]) < 0 &&
    !Number.isInteger(bpm)
  ) {
    throw new TypeError(`FL Studio ${parsed.flVersion} does not support decimal BPM values`);
  }
}

function writeTextProjectEvent(
  parsed: ParsedFlp,
  eventId: number,
  value: string | null | undefined,
): ParsedFlp {
  if (value === undefined) return parsed;

  const payload = createTextPayload(value ?? '', parsed.useUnicode);
  const existing = findFirstEvent(parsed, eventId);
  return existing
    ? replaceEventPayload(parsed, existing, payload)
    : insertProjectEvent(parsed, createEvent(eventId, payload));
}

function writeProjectBpm(parsed: ParsedFlp, bpm: number | null | undefined): ParsedFlp {
  if (bpm === undefined || bpm === null) return parsed;
  validateBpm(parsed, bpm);

  const scaledBpm = Math.round(bpm * 1000);
  const coarseBpm = Math.floor(scaledBpm / 1000);
  const fineBpm = scaledBpm % 1000;
  const modernEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TEMPO);
  const coarseEvent = findFirstEvent(parsed, EVENT_ID.PROJECT__TEMPO_COARSE);
  const fineEvent = findFirstEvent(parsed, EVENT_ID.PROJECT__TEMPO_FINE);

  let result = parsed;

  if (modernEvent) {
    result = replaceEventPayload(result, modernEvent, createNumberPayload(scaledBpm, 'u32'));
  }

  if (coarseEvent) {
    result = replaceEventPayload(result, coarseEvent, createNumberPayload(coarseBpm, 'u16'));
  }

  if (fineEvent) {
    result = replaceEventPayload(result, fineEvent, createNumberPayload(fineBpm, 'u16'));
  }

  if (!modernEvent && !coarseEvent && !fineEvent) {
    result = insertProjectEvent(
      result,
      createEvent(EVENT_ID.PROJECT_TEMPO, createNumberPayload(scaledBpm, 'u32')),
    );
  } else if (!modernEvent && coarseEvent && !fineEvent && fineBpm > 0) {
    const updatedCoarse = findFirstEvent(result, EVENT_ID.PROJECT__TEMPO_COARSE)!;
    const index = result.events.indexOf(updatedCoarse) + 1;
    const events = [...result.events];
    events.splice(
      index,
      0,
      createEvent(EVENT_ID.PROJECT__TEMPO_FINE, createNumberPayload(fineBpm, 'u16')),
    );
    result = { ...result, events };
  } else if (!modernEvent && !coarseEvent && fineEvent) {
    const updatedFine = findFirstEvent(result, EVENT_ID.PROJECT__TEMPO_FINE)!;
    const index = result.events.indexOf(updatedFine);
    const events = [...result.events];
    events.splice(
      index,
      0,
      createEvent(EVENT_ID.PROJECT__TEMPO_COARSE, createNumberPayload(coarseBpm, 'u16')),
    );
    result = { ...result, events };
  }

  return result;
}

/**
 * Writes project metadata to a parsed FLP
 * Only modifies fields that are provided (non-undefined)
 */
export function writeProjectMeta(parsed: ParsedFlp, meta: Partial<ProjectMeta>): ParsedFlp {
  let result = parsed;
  result = writeProjectBpm(result, meta.bpm);
  result = writeTextProjectEvent(result, EVENT_ID.PROJECT_TITLE, meta.name);
  result = writeTextProjectEvent(result, EVENT_ID.PROJECT_GENRE, meta.genre);
  result = writeTextProjectEvent(result, EVENT_ID.PROJECT_ARTISTS, meta.artist);
  result = writeTextProjectEvent(result, EVENT_ID.PROJECT_COMMENTS, meta.description);
  return result;
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
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Converts Delphi timestamp (days since epoch) to Date
 */
function delphiToDate(days: number): Date {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(DELPHI_EPOCH_MS + ms);
}

/**
 * Converts Date to Delphi timestamp (days since epoch)
 */
function dateToDelphiDays(date: Date): number {
  const ms = date.getTime() - DELPHI_EPOCH_MS;
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
export function writeProjectTimeInfo(parsed: ParsedFlp, info: Partial<ProjectTimeInfo>): ParsedFlp {
  if (info.creationDate === undefined && info.workTimeSeconds === undefined) {
    return parsed;
  }

  const current = readProjectTimeInfo(parsed);

  if (
    info.creationDate !== undefined &&
    info.creationDate !== null &&
    Number.isNaN(info.creationDate.getTime())
  ) {
    throw new RangeError('creationDate must be a valid Date');
  }

  if (
    info.workTimeSeconds !== undefined &&
    info.workTimeSeconds !== null &&
    (!Number.isFinite(info.workTimeSeconds) || info.workTimeSeconds < 0)
  ) {
    throw new RangeError('workTimeSeconds must be a finite, non-negative number');
  }

  const creationDateDays =
    info.creationDate === null
      ? 0
      : info.creationDate !== undefined
        ? dateToDelphiDays(info.creationDate)
        : current.creationDate !== null
          ? dateToDelphiDays(current.creationDate)
          : 0;
  const workTimeDays =
    info.workTimeSeconds === null
      ? 0
      : info.workTimeSeconds !== undefined
        ? info.workTimeSeconds / (24 * 60 * 60)
        : current.workTimeSeconds !== null
          ? current.workTimeSeconds / (24 * 60 * 60)
          : 0;

  const writer = new BinaryWriter();
  writer.writeF64LE(creationDateDays);
  writer.writeF64LE(workTimeDays);

  const timestampEvent = findFirstEvent(parsed, EVENT_ID.PROJECT_TIMESTAMP);
  return timestampEvent
    ? replaceEventPayload(parsed, timestampEvent, writer.toBuffer())
    : insertProjectEvent(parsed, createEvent(EVENT_ID.PROJECT_TIMESTAMP, writer.toBuffer()));
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
  mapper: (oldPath: string) => string,
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
      name = data.toString('utf8').replace(/\0/g, '');
    } else if (subEventId === VST_EVENT_ID.VENDOR && actualSize > 0) {
      vendor = data.toString('utf8').replace(/\0/g, '');
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
        const key = `${currentInternalName ?? ''}:${currentPluginName ?? ''}`;
        if (
          !seenPlugins.has(key) &&
          currentInternalName &&
          currentInternalName !== 'Fruity Wrapper'
        ) {
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
    if (event.id === EVENT_ID.PLUGIN_DATA && currentInternalName === 'Fruity Wrapper') {
      const vstData = parseVstPluginData(event.payload);
      if (vstData.name) {
        const key = `vst:${vstData.name}:${vstData.vendor ?? ''}`;
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
  if (currentInternalName && currentInternalName !== 'Fruity Wrapper') {
    const key = `${currentInternalName}:${currentPluginName ?? ''}`;
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
