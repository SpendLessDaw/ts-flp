/**
 * ts-flp - A minimal TypeScript port of PyFLP for FL Studio .flp files
 *
 * This library provides conservative (non-destructive) parsing and patching
 * of FL Studio project files. It preserves all unknown data byte-for-byte.
 *
 * Features:
 * - Read and modify project metadata (name, description, artist, BPM)
 * - Read and modify timestamps (creation date, work time)
 * - List and remap sample paths
 * - List VST plugins (name and vendor)
 * - Conservative round-trip: unchanged files are byte-identical
 *
 * @example
 * ```typescript
 * import { parseFlp, serializeFlp, readProjectMeta, writeProjectMeta } from "ts-flp";
 * import * as fs from "fs";
 *
 * // Parse an FLP file
 * const buffer = fs.readFileSync("project.flp");
 * const parsed = parseFlp(buffer);
 *
 * // Read metadata
 * const meta = readProjectMeta(parsed);
 * console.log(meta.name, meta.bpm);
 *
 * // Modify and save
 * const modified = writeProjectMeta(parsed, { bpm: 140 });
 * fs.writeFileSync("project_modified.flp", serializeFlp(modified));
 * ```
 */

// Re-export parser functions
export {
  createEvent, createNumberPayload, createTextPayload, findEvents,
  findFirstEvent, getEventNumber, getEventString, parseFlp, patchEvents, serializeFlp, type FlpEvent, type ParsedFlp
} from "./src/parser/FlpParser.js";

// Re-export API functions
export {
  getFlVersion,
  getPPQ,
  listPlugins,
  listSamples,
  readProjectMeta,
  readProjectTimeInfo,
  rewriteSamplePaths,
  writeProjectMeta,
  writeProjectTimeInfo,
  type PluginRef,
  type ProjectMeta,
  type ProjectTimeInfo,
  type SampleRef
} from "./src/api/ProjectApi.js";

// Re-export event constants
export { EVENT_ID, EVENT_KIND, getEventFixedSize, getEventKind } from "./src/generated/events.generated.js";

// Re-export IO utilities for advanced usage
export { BinaryReader } from "./src/io/BinaryReader.js";
export { BinaryWriter, encodeVarInt, varIntSize } from "./src/io/BinaryWriter.js";

