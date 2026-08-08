# Local FLP test projects

Place at least one `.flp` project directly in this directory before running:

```bash
pnpm test
```

The test suite deliberately fails when no project is available because the parser's
round-trip and patching behavior must be verified against a real FL Studio file.

All other files in this directory are ignored by Git. Keep personal and confidential
projects local; never force-add them to the repository.

Tests use a temporary system directory for generated files and do not modify the projects
stored here.
