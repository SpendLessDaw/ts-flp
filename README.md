# Typescript FLP Library

A minimalist TypeScript library for reading and modifying FL Studio project files (`.flp`).

Designed for **non-destructive** modifications ("conservative patch").

## Features

- **Project metadata**: Read and modify name, description, artist, genre, and BPM
- **Time information**: Read and modify creation date and work time
- **Samples**: List sample paths and batch rewrite paths
- **VST Plugins**: List plugins with name and vendor (when available)
- **Stable round-trip**: Untargeted data remains byte-for-byte identical

## Installation

```bash
npm install ts-flp
# or
pnpm add ts-flp
# or
yarn add ts-flp
```

## Usage

### Reading a project

```typescript
import { readFileSync, writeFileSync } from 'fs';
import { parseFlp, serializeFlp, readProjectMeta, listSamples, listPlugins } from 'ts-flp';

// Load and parse the .flp file
const buffer = readFileSync('my-project.flp');
const parsed = parseFlp(buffer);

// Read metadata
const meta = readProjectMeta(parsed);
console.log(`Project: ${meta.name}`);
console.log(`Artist: ${meta.artist}`);
console.log(`Genre: ${meta.genre}`);
console.log(`BPM: ${meta.bpm}`);

// List samples
const samples = listSamples(parsed);
for (const sample of samples) {
  console.log(`Sample: ${sample.path}`);
}

// List plugins
const plugins = listPlugins(parsed);
for (const plugin of plugins) {
  console.log(`Plugin: ${plugin.name} (${plugin.vendor ?? 'N/A'})`);
}
```

### Modifying metadata

```typescript
import { readFileSync, writeFileSync } from 'fs';
import { parseFlp, serializeFlp, writeProjectMeta } from 'ts-flp';

const buffer = readFileSync('my-project.flp');
let parsed = parseFlp(buffer);

// Modify metadata
parsed = writeProjectMeta(parsed, {
  name: 'New Title',
  artist: 'My Name',
  genre: 'Electronic',
  bpm: 140,
});

// Save
writeFileSync('my-project-modified.flp', serializeFlp(parsed));
```

### Rewriting sample paths

```typescript
import { readFileSync, writeFileSync } from 'fs';
import { parseFlp, serializeFlp, rewriteSamplePaths } from 'ts-flp';

const buffer = readFileSync('my-project.flp');
let parsed = parseFlp(buffer);

// Remap paths (e.g., disk migration)
parsed = rewriteSamplePaths(parsed, (oldPath) => {
  return oldPath.replace('D:\\Samples\\', 'E:\\NewSamples\\');
});

writeFileSync('my-project-migrated.flp', serializeFlp(parsed));
```

### Modifying time information

```typescript
import { readFileSync, writeFileSync } from 'fs';
import { parseFlp, serializeFlp, readProjectTimeInfo, writeProjectTimeInfo } from 'ts-flp';

const buffer = readFileSync('my-project.flp');
let parsed = parseFlp(buffer);

// Read time info
const timeInfo = readProjectTimeInfo(parsed);
console.log(`Created on: ${timeInfo.creationDate}`);
console.log(`Work time: ${timeInfo.workTimeSeconds} seconds`);

// Modify creation date
parsed = writeProjectTimeInfo(parsed, {
  creationDate: new Date('2024-01-01'),
  workTimeSeconds: 3600, // 1 hour
});

writeFileSync('my-project-modified.flp', serializeFlp(parsed));
```

## API

### Main types

```typescript
interface ProjectMeta {
  name: string | null;
  description: string | null;
  artist: string | null;
  genre: string | null;
  bpm: number | null;
}

interface ProjectTimeInfo {
  creationDate: Date | null;
  workTimeSeconds: number | null;
}

interface SampleRef {
  eventIndex: number;
  path: string;
}

interface PluginRef {
  name: string | null;
  vendor: string | null;
}
```

### Functions

| Function                             | Description                                        |
| ------------------------------------ | -------------------------------------------------- |
| `parseFlp(buffer)`                   | Parse a `.flp` buffer into a `ParsedFlp` structure |
| `serializeFlp(parsed)`               | Serialize a `ParsedFlp` structure to buffer        |
| `readProjectMeta(parsed)`            | Read project metadata                              |
| `writeProjectMeta(parsed, meta)`     | Modify project metadata                            |
| `readProjectTimeInfo(parsed)`        | Read time information                              |
| `writeProjectTimeInfo(parsed, info)` | Modify time information                            |
| `listSamples(parsed)`                | List all samples in the project                    |
| `rewriteSamplePaths(parsed, mapper)` | Batch rewrite sample paths                         |
| `listPlugins(parsed)`                | List all plugins (VST and native)                  |
| `getFlVersion(parsed)`               | Get the FL Studio version string                   |
| `getPPQ(parsed)`                     | Get the PPQ (Pulses Per Quarter note)              |

## Constraints and limitations

### What this library does

- **Non-destructive** read and write of `.flp` files
- Byte-for-byte preservation of unmodified data
- Compatibility with FL Studio 11.5+ (UTF-16LE strings)

### What this library does NOT do

- Full editor for patterns, mixer, playlist, automation
- Create `.flp` files from scratch
- Guarantee VST `vendor` availability (returns `null` if not serialized)
- Support compressed (zipped) `.flp` files

## Architecture

```
src/
  generated/
    events.generated.ts    # Event constants
  io/
    BinaryReader.ts        # Binary reading
    BinaryWriter.ts        # Binary writing
  parser/
    FlpParser.ts           # .flp Parser/Serializer
  api/
    ProjectApi.ts          # High-level API
  index.ts                 # Entry point
```

## Development

```bash
# Install dependencies
pnpm install

# Type checking
pnpm run typecheck

# Tests
pnpm run test

# Build
pnpm run build
```

## Credits

- [PyFLP](https://github.com/demberto/PyFLP) - Reference implementation for FL Studio file format
- [smart-buffer](https://github.com/JoshGlazebrook/smart-buffer) - Binary read/write
- [protobufjs](https://github.com/protobufjs/protobuf.js) - VarInt encoding

## License

[GPL-3.0](LICENSE)

---

## Acknowledgements

A huge thank you to **[@demberto](https://github.com/demberto)** ([PyFLP](https://github.com/demberto/PyFLP)), **[@monadgroup](https://github.com/monadgroup)** ([FLParser](https://github.com/monadgroup/FLParser)), and **FLPEdit** for their incredible reverse-engineering work on the FL Studio `.flp` format.

This project would never have been possible without them.
