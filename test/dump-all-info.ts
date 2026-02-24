import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  getFlVersion,
  getPPQ,
  listPlugins,
  listSamples,
  parseFlp,
  readProjectMeta,
  readProjectTimeInfo,
} from '../index.js';

type EventSummary = {
  total: number;
  byId: Record<number, number>;
  byKind: Record<string, number>;
};

function summarizeEvents(events: Array<{ id: number; kind: string }>): EventSummary {
  const byId: Record<number, number> = {};
  const byKind: Record<string, number> = {};

  for (const event of events) {
    byId[event.id] = (byId[event.id] ?? 0) + 1;
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
  }

  return {
    total: events.length,
    byId,
    byKind,
  };
}

function collectFlpInfo(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const parsed = parseFlp(buffer);

  return {
    file: {
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: buffer.length,
    },
    project: {
      flVersion: getFlVersion(parsed),
      ppq: getPPQ(parsed),
      useUnicode: parsed.useUnicode,
      metadata: readProjectMeta(parsed),
      timeInfo: readProjectTimeInfo(parsed),
    },
    samples: listSamples(parsed),
    plugins: listPlugins(parsed),
    events: summarizeEvents(parsed.events),
  };
}

function resolveInputFiles(): string[] {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs.filter((arg) => !arg.startsWith('--'));

  const cwd = process.cwd();
  const defaultDir = path.join(cwd, 'test_projs');

  if (args.length === 0) {
    if (!fs.existsSync(defaultDir)) {
      throw new Error(`Dossier introuvable: ${defaultDir}`);
    }
    return fs
      .readdirSync(defaultDir)
      .filter((file) => file.endsWith('.flp'))
      .map((file) => path.join(defaultDir, file));
  }

  const inputPath = path.resolve(cwd, args[0]!);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Chemin introuvable: ${inputPath}`);
  }

  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(inputPath)
      .filter((file) => file.endsWith('.flp'))
      .map((file) => path.join(inputPath, file));
  }

  return [inputPath];
}

async function selectFileInteractively(inputFiles: string[]): Promise<string> {
  if (inputFiles.length === 1) {
    return inputFiles[0]!;
  }

  console.log('Choisis un fichier FLP a inspecter:');
  inputFiles.forEach((filePath, index) => {
    console.log(`${index + 1}. ${path.basename(filePath)}`);
  });

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question('Entre le numero du fichier: ');
      const selectedIndex = Number.parseInt(answer.trim(), 10);

      if (Number.isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > inputFiles.length) {
        console.log(`Numero invalide. Choisis un nombre entre 1 et ${inputFiles.length}.`);
        continue;
      }

      return inputFiles[selectedIndex - 1]!;
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const inputFiles = resolveInputFiles();
  if (inputFiles.length === 0) {
    throw new Error('Aucun fichier .flp trouve.');
  }

  const allFlag = process.argv.includes('--all');
  const report = allFlag
    ? inputFiles.map((filePath) => collectFlpInfo(filePath))
    : collectFlpInfo(await selectFileInteractively(inputFiles));
  const outputJson = JSON.stringify(report, null, 2);

  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  if (outArg) {
    const outPath = path.resolve(process.cwd(), outArg.replace('--out=', ''));
    fs.writeFileSync(outPath, outputJson, 'utf8');
    console.log(`Rapport ecrit dans: ${outPath}`);
    return;
  }

  console.log(outputJson);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erreur: ${message}`);
  process.exit(1);
});
