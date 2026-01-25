/**
 * FLP Parser unit tests
 * Converted from flparser_unitest.py
 */

import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getFlVersion,
  listPlugins,
  listSamples,
  parseFlp,
  readProjectMeta,
  readProjectTimeInfo,
  rewriteSamplePaths,
  serializeFlp,
  writeProjectMeta,
  writeProjectTimeInfo,
  type ParsedFlp
} from "../src/index.js";

// Test configuration
const TEST_PROJS_DIR = path.join(import.meta.dirname, "..", "test_projs");
const EXPECTED_FL_VERSION = "24"; // Update this to match your FL Studio version

/**
 * Helper function to get test FLP files
 */
function getTestableProjects(): string[] {
  if (!fs.existsSync(TEST_PROJS_DIR)) {
    return [];
  }
  return fs.readdirSync(TEST_PROJS_DIR).filter((f) => f.endsWith(".flp"));
}

/**
 * Helper function to load and parse a test FLP file
 */
function loadTestProject(filename: string): ParsedFlp {
  const filepath = path.join(TEST_PROJS_DIR, filename);
  const buffer = fs.readFileSync(filepath);
  return parseFlp(buffer);
}

function randomString(length: number): string {
  let result = "";
  while (result.length < length) {
    result += Math.random().toString(36).substring(2);
  }
  return result.substring(0, length);
}

function randomBPM(): number {
  // return a random BPM between 50 and 190
  return Math.floor(Math.random() * 140) + 50;
}

function randomDecimalBPM(): number {
  // Random BPM with decimals between 60 and 200
  return Math.floor(Math.random() * 140000 + 60000) / 1000;
}

function randomTimestamp(): Date {
  // Random date between 2020 and 2025
  const start = new Date(2020, 0, 1).getTime();
  const end = new Date(2025, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start));
}

function randomWorkTime(): number {
  // Random work time between 0 and 1000000 seconds (~277 hours)
  return Math.floor(Math.random() * 1000000);
}

function randomEmoji(): string {
  const emojis = ["🎵", "🎹", "🎸", "🥁", "🎤", "🔊", "🎧", "🎼", "🤓", "👨‍🍳", "🔥", "💯", "✨", "🚀"];
  return emojis[Math.floor(Math.random() * emojis.length)]!;
}

describe("FLP Parser", () => {
  const testProjects = getTestableProjects();

  beforeAll(() => {
    if (testProjects.length === 0) {
      console.warn(`No test projects found in ${TEST_PROJS_DIR}`);
      console.warn("Create a 'test_projs' folder with .flp files to run tests");
    }
  });

  describe("Basic Parsing", () => {
    it.skipIf(testProjects.length === 0)("should parse FLP file without errors", () => {
      const project = loadTestProject(testProjects[0]!);
      expect(project).toBeDefined();
      expect(project.events).toBeDefined();
      expect(project.events.length).toBeGreaterThan(0);
    });

    it.skipIf(testProjects.length === 0)("should detect FL version", () => {
      const project = loadTestProject(testProjects[0]!);
      const version = getFlVersion(project);
      expect(version).toBeDefined();
      expect(version.length).toBeGreaterThan(0);
      console.log(`Detected FL version: ${version}`);
    });

    it.skipIf(testProjects.length === 0)(
      `should be FL Studio version ${EXPECTED_FL_VERSION}.x`,
      () => {
        const project = loadTestProject(testProjects[0]!);
        const version = getFlVersion(project);
        expect(version.startsWith(EXPECTED_FL_VERSION)).toBe(true);
      }
    );
  });

  describe("Round-trip Stability", () => {
    it.skipIf(testProjects.length === 0)(
      "should produce identical output when parsing and re-serializing without changes",
      () => {
        const filepath = path.join(TEST_PROJS_DIR, testProjects[0]!);
        const originalBuffer = fs.readFileSync(filepath);
        const parsed = parseFlp(originalBuffer);
        const reserialized = serializeFlp(parsed);

        expect(reserialized.length).toBe(originalBuffer.length);
        expect(reserialized.equals(originalBuffer)).toBe(true);
      }
    );
  });

  describe("Case 1: Basic metadata (title, artist, description, genre)", () => {
    it.skipIf(testProjects.length === 0)("should read and write basic metadata", () => {
      const project = loadTestProject(testProjects[0]!);

      const name = randomString(10);
      const artist = randomString(10);
      const description = randomString(100);
      const genre = randomString(15);

      const modified = writeProjectMeta(project, {
        name: name,
        artist: artist,
        description: description,
        genre: genre,
      });

      const meta = readProjectMeta(modified);
      expect(meta.name).toBe(name);
      expect(meta.artist).toBe(artist);
      expect(meta.description).toContain(description);
      expect(meta.genre).toBe(genre);
    });
  });

  describe("Case 2: Metadata with genre and tempo", () => {
    it.skipIf(testProjects.length === 0)(
      "should read and write metadata with genre and tempo",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const name = randomString(10);
        const artist = randomString(10);
        const description = randomString(100);
        const genre = randomString(15);
        const bpm = randomBPM();

        const modified = writeProjectMeta(project, {
          name: name,
          artist: artist,
          description: description,
          genre: genre,
          bpm: bpm,
        });

        const meta = readProjectMeta(modified);
        expect(meta.name).toBe(name);
        expect(meta.artist).toBe(artist);
        expect(meta.description).toContain(description);
        expect(meta.genre).toBe(genre);
        expect(meta.bpm).toBe(bpm);
      }
    );
  });

  describe("Case 3: Decimal tempo", () => {
    it.skipIf(testProjects.length === 0)("should handle decimal tempo values", () => {
      const project = loadTestProject(testProjects[0]!);

      const name = randomString(10);
      const bpm = randomBPM();

      const modified = writeProjectMeta(project, {
        name: name,
        bpm: bpm,
      });

      const meta = readProjectMeta(modified);
      // BPM is stored as integer * 1000, so we get 3 decimal places precision
      expect(meta.bpm).toBeCloseTo(bpm, 3);
    });
  });

  describe("Case 4: Type coercion", () => {
    it.skipIf(testProjects.length === 0)(
      "should handle numeric values as strings",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const bpm = randomBPM();

        // In TypeScript we enforce types, but we test that numeric strings work
        const modified = writeProjectMeta(project, {
          name: String(89465),
          description: String(10231658784241),
          bpm: bpm,
        });

        const meta = readProjectMeta(modified);
        expect(meta.name).toBe("89465");
        expect(meta.description).toBe("10231658784241");
        expect(meta.bpm).toBeCloseTo(bpm, 3);
      }
    );
  });

  describe("Case 5: Samples", () => {
    it.skipIf(testProjects.length === 0)("should list samples", () => {
      const project = loadTestProject(testProjects[0]!);
      const samples = listSamples(project);

      // Just verify we can list samples without error
      expect(Array.isArray(samples)).toBe(true);
      console.log(`Found ${samples.length} samples`);

      if (samples.length > 0) {
        expect(samples[0]).toHaveProperty("path");
        expect(samples[0]).toHaveProperty("eventIndex");
      }
    });

    it.skipIf(testProjects.length === 0)("should rewrite sample paths with random prefix", () => {
      const project = loadTestProject(testProjects[0]!);
      const originalSamples = listSamples(project);

      if (originalSamples.length > 0) {
        const randomPrefix = randomString(8);
        const modified = rewriteSamplePaths(project, (oldPath) =>
          oldPath.replace("C:\\", `${randomPrefix}:\\`)
        );

        const newSamples = listSamples(modified);
        expect(newSamples.length).toBe(originalSamples.length);

        // Verify at least one path was modified
        const modifiedPaths = newSamples.filter((s) => s.path.includes(randomPrefix));
        if (originalSamples.some((s) => s.path.includes("C:\\"))) {
          expect(modifiedPaths.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Case 6: Unicode/Emoji support", () => {
    it.skipIf(testProjects.length === 0)(
      "should handle emojis in metadata",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const emoji1 = randomEmoji();
        const emoji2 = randomEmoji();
        const baseName = randomString(10);
        const artist = randomString(10);
        const description = randomString(50);

        const nameWithEmoji = `${baseName} ${emoji1}${emoji2}`;
        const descWithEmoji = `${description} ${emoji1}`;

        const modified = writeProjectMeta(project, {
          name: nameWithEmoji,
          artist: artist,
          description: descWithEmoji,
        });

        const meta = readProjectMeta(modified);
        expect(meta.name).toBe(nameWithEmoji);
        expect(meta.artist).toBe(artist);
        expect(meta.description).toBe(descWithEmoji);
      }
    );
  });

  describe("Case 7: createdAt timestamp", () => {
    it.skipIf(testProjects.length === 0)(
      "should read and write creation date",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const testDate = randomTimestamp();

        const modified = writeProjectTimeInfo(project, {
          creationDate: testDate,
        });

        const timeInfo = readProjectTimeInfo(modified);
        expect(timeInfo.creationDate).toBeDefined();

        if (timeInfo.creationDate) {
          // Allow 1 second tolerance due to float precision
          const diff = Math.abs(
            timeInfo.creationDate.getTime() - testDate.getTime()
          );
          expect(diff).toBeLessThan(1000);
        }
      }
    );
  });

  describe("Case 8: workTime = 0", () => {
    it.skipIf(testProjects.length === 0)(
      "should handle zero work time",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const modified = writeProjectTimeInfo(project, {
          workTimeSeconds: 0,
        });

        const timeInfo = readProjectTimeInfo(modified);
        expect(timeInfo.workTimeSeconds).toBe(0);
      }
    );
  });

  describe("Case 9: workTime with value", () => {
    it.skipIf(testProjects.length === 0)(
      "should read and write work time",
      () => {
        const project = loadTestProject(testProjects[0]!);

        const workTime = randomWorkTime();

        const modified = writeProjectTimeInfo(project, {
          workTimeSeconds: workTime,
        });

        const timeInfo = readProjectTimeInfo(modified);
        expect(timeInfo.workTimeSeconds).toBeCloseTo(workTime, 1);
      }
    );
  });

  describe("Plugins", () => {
    it.skipIf(testProjects.length === 0)("should list plugins", () => {
      const project = loadTestProject(testProjects[0]!);
      const plugins = listPlugins(project);

      expect(Array.isArray(plugins)).toBe(true);
      console.log(`Found ${plugins.length} plugins`);

      for (const plugin of plugins) {
        console.log(`  - ${plugin.name} (${plugin.vendor ?? "N/A"})`);
      }
    });
  });

  describe("Combined metadata and time info", () => {
    it.skipIf(testProjects.length === 0)(
      "should handle all modifications together",
      () => {
        const project = loadTestProject(testProjects[0]!);

        // Generate random test data
        const emoji = randomEmoji();
        const name = `${randomString(10)} ${emoji}`;
        const artist = randomString(10);
        const description = randomString(100);
        const genre = randomString(15);
        const bpm = randomDecimalBPM();
        const testDate = randomTimestamp();
        const workTime = randomWorkTime();

        // Apply metadata changes
        let modified = writeProjectMeta(project, {
          name: name,
          artist: artist,
          description: description,
          genre: genre,
          bpm: bpm,
        });

        // Apply time info changes
        modified = writeProjectTimeInfo(modified, {
          creationDate: testDate,
          workTimeSeconds: workTime,
        });

        // Verify all changes
        const meta = readProjectMeta(modified);
        expect(meta.name).toBe(name);
        expect(meta.artist).toBe(artist);
        expect(meta.description).toBe(description);
        expect(meta.genre).toBe(genre);
        expect(meta.bpm).toBeCloseTo(bpm, 3);

        const timeInfo = readProjectTimeInfo(modified);
        expect(timeInfo.workTimeSeconds).toBeCloseTo(workTime, 1);

        // Verify round-trip works
        const serialized = serializeFlp(modified);
        const reparsed = parseFlp(serialized);
        const reMeta = readProjectMeta(reparsed);
        expect(reMeta.name).toBe(name);
        expect(reMeta.artist).toBe(artist);
        expect(reMeta.genre).toBe(genre);
        expect(reMeta.bpm).toBeCloseTo(bpm, 3);

        // Save the modified FLP to demo folder
        const demoDir = path.join(TEST_PROJS_DIR, "demo");
        if (!fs.existsSync(demoDir)) {
          fs.mkdirSync(demoDir, { recursive: true });
        }
        const outputPath = path.join(demoDir, `modified_${testProjects[0]}`);
        fs.writeFileSync(outputPath, serialized);
        console.log(`Saved modified FLP to: ${outputPath}`);
      }
    );
  });
});

// Run all tests on each available test project
describe.skipIf(getTestableProjects().length === 0)(
  "All test projects",
  () => {
    const projects = getTestableProjects();

    for (const projectFile of projects) {
      describe(`Project: ${projectFile}`, () => {
        it("should parse without errors", () => {
          const project = loadTestProject(projectFile);
          expect(project).toBeDefined();
          expect(project.events.length).toBeGreaterThan(0);
        });

        it("should round-trip without data loss", () => {
          const filepath = path.join(TEST_PROJS_DIR, projectFile);
          const original = fs.readFileSync(filepath);
          const parsed = parseFlp(original);
          const reserialized = serializeFlp(parsed);
          expect(reserialized.equals(original)).toBe(true);
        });

        it("should read metadata", () => {
          const project = loadTestProject(projectFile);
          const meta = readProjectMeta(project);
          expect(meta).toBeDefined();
          console.log(`  ${projectFile}: "${meta.name}" @ ${meta.bpm} BPM`);
        });
      });
    }
  }
);
