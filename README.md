# Ordovera Plugins

Open source Claude Code plugins for building, securing, and governing AI agent systems.

## Install

```bash
/plugin marketplace add ordovera/ordovera-plugins
```

Then install individual plugins:

```bash
/plugin install context-setup@ordovera-plugins
/plugin install top10-scan@ordovera-plugins
```

## Plugins

### context-setup

Scaffold, audit, align, optimize MCP tools, and upgrade context engineering files. Generates AGENTS.md files, context directories, and cascading structures from project analysis.

Originally developed as part of [context-engineering](https://github.com/fending/context-engineering).

[Documentation](plugins/context-setup/README.md)

### top10-scan

OWASP Top 10:2025 multi-layer security audit. Orchestrates Opengrep (SAST), ZAP (DAST), and Dependency-Check (SCA) alongside Claude's design-level analysis.

*Coming soon.*

## License

MIT
