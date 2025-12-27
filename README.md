# opencode-ccusage-exporter

Export OpenCode sessions to ccusage-compatible JSONL format.

This tool converts OpenCode session data into the JSONL format that [ccusage](https://github.com/ryoppippi/ccusage) understands, allowing you to track your OpenCode usage alongside Claude Code usage.

## Installation

```bash
# Clone and install
git clone https://github.com/ggfincke/opencode-to-ccusage
cd opencode-to-ccusage
npm install

# Or run directly with npx (after publishing)
npx opencode-ccusage-exporter --help
```

## Prerequisites

- **Node.js 18+**
- **OpenCode CLI** must be installed and accessible in your PATH
  ```bash
  # Verify OpenCode is installed
  opencode --version
  
  # List sessions to confirm it works
  opencode session list
  ```
- **ccusage** (for the `report` command)
  ```bash
  npm install -g ccusage
  ```

## Quick Start

```bash
# See your combined OpenCode + Claude Code usage
npx tsx src/index.ts

# Or just export OpenCode sessions (without running ccusage)
npx tsx src/index.ts export
```

That's it! Running with no arguments will:
1. Export all OpenCode sessions to `~/.config/claude-opencode/`
2. Run `ccusage` with both Claude Code and OpenCode data

## Commands

### `report` (default)

Generate a usage report combining OpenCode and Claude Code data:

```bash
# Run the default report (exports + ccusage)
npx tsx src/index.ts report

# OpenCode usage only
npx tsx src/index.ts report --opencode-only

# Claude Code usage only (skips export)
npx tsx src/index.ts report --claude-only

# Skip the export step (use existing data)
npx tsx src/index.ts report --skip-export

# Pass options through to ccusage
npx tsx src/index.ts report --monthly
npx tsx src/index.ts report --since 7

# Verbose output
npx tsx src/index.ts report -v
```

### `export`

Export OpenCode sessions to ccusage-compatible JSONL format:

```bash
# Export to default location (~/.config/claude-opencode/)
npx tsx src/index.ts export

# Export to custom directory
npx tsx src/index.ts export --out ./my-output

# Export only recent sessions
npx tsx src/index.ts export --since 7

# Preview without writing (dry run)
npx tsx src/index.ts export --dry-run

# Verbose output
npx tsx src/index.ts export -v
```

### `advanced`

Full control over all export options (legacy CLI interface):

```bash
npx tsx src/index.ts advanced --out <dir> [options]
```

See [Advanced Export Options](#advanced-export-options) for all flags.

## Usage (Legacy)

### Basic Export

```bash
# Export all sessions to a directory
npx tsx src/index.ts --out ~/.config/claude-opencode

# Or if you have tsx installed globally
tsx src/index.ts --out ~/.config/claude-opencode
```

### Run ccusage with OpenCode Data

```bash
# After exporting, run ccusage pointing to your output directory
CLAUDE_CONFIG_DIR=~/.config/claude-opencode ccusage

# Or combine with your existing Claude Code data
# (ccusage supports comma-separated directories)
CLAUDE_CONFIG_DIR=~/.config/claude,~/.config/claude-opencode ccusage
```

### Export Options

```bash
# Export only sessions from the last 7 days
npx tsx src/index.ts --out ./output --since 7

# Export since a specific date
npx tsx src/index.ts --out ./output --since 2025-01-01

# Preview without writing (dry run)
npx tsx src/index.ts --out ./output --dry-run

# Overwrite existing files
npx tsx src/index.ts --out ./output --overwrite

# Show verbose progress
npx tsx src/index.ts --out ./output --verbose

# Exclude reasoning tokens from output_tokens
npx tsx src/index.ts --out ./output --no-include-reasoning-in-output

# Group by OpenCode project (for per-project usage in ccusage)
npx tsx src/index.ts --out ./output --group-by project

# Use custom OpenCode data directory
npx tsx src/index.ts --out ./output --opencode-dir /path/to/opencode/data
```

### Advanced Export Options

For full control, use the `advanced` command:

```bash
npx tsx src/index.ts advanced --out <dir> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--out <dir>` | Output directory (required) | - |
| `--overwrite` | Overwrite existing session files | `false` |
| `--since <value>` | Only export after date (ISO) or days (number) | all |
| `--include-reasoning-in-output` | Add reasoning tokens to output_tokens | `true` |
| `--no-include-reasoning-in-output` | Exclude reasoning tokens | - |
| `--group-by <strategy>` | Output grouping: `flat`, `project`, `directory` | `flat` |
| `--opencode-dir <path>` | Override OpenCode data directory | auto-detected |
| `--dry-run` | Preview without writing | `false` |
| `--verbose` | Show detailed progress | `false` |
| `-h, --help` | Show help | - |
| `-v, --version` | Show version | - |

### Grouping Strategies

The `--group-by` flag controls how sessions are organized in the output:

- **`flat`** (default): All sessions in `projects/opencode/`
  - Simple, all OpenCode usage in one "project" in ccusage
  
- **`project`**: Group by OpenCode projectID → `projects/opencode-<projectID>/`
  - Preserves per-project usage separation in ccusage
  
- **`directory`**: Group by directory hash → `projects/opencode-<hash>/`
  - Groups sessions by their working directory

## Output Format

Creates files in:
```
<OUT>/
  projects/
    opencode/                          # with --group-by flat (default)
      <SESSION_ID>.jsonl
    opencode-<PROJECT_ID>/             # with --group-by project
      <SESSION_ID>.jsonl
    opencode-<HASH>/                   # with --group-by directory
      <SESSION_ID>.jsonl
```

Each JSONL file contains one line per assistant message (model call), sorted by timestamp:

```json
{"timestamp":"2025-12-26T21:40:04.586Z","sessionId":"ses_xxx","cwd":"/path/to/project","requestId":"opencode:ses_xxx:msg_yyy","message":{"id":"msg_yyy","model":"claude-opus-4-5","usage":{"input_tokens":100,"output_tokens":250,"cache_read_input_tokens":1000,"cache_creation_input_tokens":500}}}
```

### Field Mapping

| ccusage Field | OpenCode Source |
|---------------|-----------------|
| `timestamp` | `message.time.completed` (or `created`) |
| `sessionId` | `session.info.id` |
| `cwd` | `message.path.cwd` |
| `requestId` | `opencode:<sessionId>:<messageId>` |
| `message.id` | `message.id` |
| `message.model` | `message.modelID` |
| `message.usage.input_tokens` | `message.tokens.input` |
| `message.usage.output_tokens` | `message.tokens.output` + `reasoning` (configurable) |
| `message.usage.cache_read_input_tokens` | `message.tokens.cache.read` |
| `message.usage.cache_creation_input_tokens` | `message.tokens.cache.write` |

### Token Fields

The following token fields are passed through as-is from OpenCode:

- `input_tokens`: Tokens in the prompt
- `output_tokens`: Tokens generated (+ reasoning if `--include-reasoning-in-output`)
- `cache_read_input_tokens`: Tokens read from cache
- `cache_creation_input_tokens`: Tokens written to cache

**Note on cache tokens:** Cache creation tokens can be significantly larger than prompt tokens as they represent the full context being cached. These are passed through for completeness but may skew cost estimation in ccusage if the pricing model doesn't account for cache semantics properly.

**Note on costUSD:** The `costUSD` field is intentionally omitted since OpenCode doesn't currently provide reliable cost data. Cost should be computed by ccusage based on token counts and model pricing.

### What Gets Exported

- **Included:** Assistant messages with any token activity (input, output, reasoning, cache read, or cache write)
- **Excluded:** User messages, messages with zero tokens across all fields, duplicate messages

## Storage Locations

OpenCode uses XDG Base Directory conventions for storing session data:

| Platform | Default Location |
|----------|------------------|
| Linux | `$XDG_DATA_HOME/opencode/storage/` or `~/.local/share/opencode/storage/` |
| macOS | `~/.local/share/opencode/storage/` (OpenCode uses xdg-basedir) |
| Windows | `%LOCALAPPDATA%/opencode/storage/` |

You can override this with:
- `--opencode-dir <path>` flag
- `OPENCODE_DATA_DIR` environment variable

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run the CLI
npx tsx src/index.ts --out ./test-output --dry-run
```

## How It Works

1. **Session Discovery:** Reads directly from OpenCode storage to enumerate all sessions across all projects
2. **Export:** For each session, calls `opencode export <sessionId>` from the session's directory
3. **Convert:** Transforms OpenCode's message format to ccusage's JSONL schema
4. **Filter:** Only includes assistant messages with token activity (billable calls)
5. **Deduplicate:** Removes duplicate messages by (messageId, timestamp)
6. **Sort:** Orders output by timestamp ascending
7. **Write:** Saves to output directory based on `--group-by` strategy

## Troubleshooting

### "OpenCode CLI not found"

Make sure OpenCode is installed and in your PATH:
```bash
npm install -g opencode
opencode --version
```

If installed via Homebrew:
```bash
brew link opencode
```

### "No sessions found"

Check that you have OpenCode sessions:
```bash
opencode session list
```

Or verify the storage location:
```bash
ls ~/.local/share/opencode/storage/session/
```

### Sessions not appearing in ccusage

1. Verify the output directory contains JSONL files:
   ```bash
   ls -la ~/.config/claude-opencode/projects/opencode/
   ```

2. Check that JSONL files have content:
   ```bash
   head -1 ~/.config/claude-opencode/projects/opencode/*.jsonl
   ```

3. Ensure CLAUDE_CONFIG_DIR points to the parent of `projects/`:
   ```bash
   # Correct - points to directory containing projects/
   CLAUDE_CONFIG_DIR=~/.config/claude-opencode ccusage
   
   # Wrong - points to projects/ directly
   CLAUDE_CONFIG_DIR=~/.config/claude-opencode/projects ccusage
   ```

### Export fails for specific sessions

Some sessions may fail to export if:
- The session's working directory no longer exists
- The session data is corrupted
- The session is currently active in OpenCode

Failed sessions are logged with details and skipped; other sessions continue exporting.

## License

MIT
