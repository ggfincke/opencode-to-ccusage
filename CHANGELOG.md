# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-27

### Added

- Initial release
- Export OpenCode sessions to ccusage-compatible JSONL format
- `report` command: Generate combined usage reports with OpenCode + Claude Code data
- `export` command: Export OpenCode sessions to JSONL files
- `advanced` command: Full control over all export options
- Support for multiple grouping strategies: `flat`, `project`, `directory`
- Session filtering by date (`--since` flag)
- Dry-run mode for previewing exports
- Verbose output mode
- Configurable reasoning token handling
- Automatic session discovery from OpenCode storage
- Cross-platform support (Linux, macOS, Windows)

[0.1.0]: https://github.com/ggfincke/opencode-to-ccusage/releases/tag/v0.1.0
