# Attack Surface Map

## Endpoints

| Route | Method | Auth Required | Data Sensitivity | Notes |
| ----- | ------ | ------------- | ---------------- | ----- |
{{#each endpoints}}
| {{route}} | {{method}} | {{auth_required}} | {{data_sensitivity}} | {{notes}} |
{{/each}}

## Authentication Mechanisms

{{#each auth_mechanisms}}
- **{{name}}**: {{description}}
{{/each}}

## External Integrations

{{#each integrations}}
- **{{name}}** ({{type}}): {{description}}
{{/each}}

## Secrets Handling

{{#each secrets}}
- **{{name}}**: {{storage_method}} - {{risk_level}}
{{/each}}
