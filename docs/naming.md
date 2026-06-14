# Naming Convention

Schema, table, column, and TypeScript type names are aligned by design.
Reading any one of them tells you exactly where to find the others.

## Pattern

```
prop_{type}.{table}.{column}  →  Prop{Type}{Table}{Column}
```

Current types: `component`, `service`. Future types get their own schema (`prop_workflow`, `prop_agent`, etc.) and follow the same pattern.

Each segment is PascalCased and concatenated. The `prop_` prefix and underscore are dropped.
`{Type}` = `Component` | `Service` (extensible)

```
prop_component.def.contract  →  PropComponentDefContract
prop_component.state.fields  →  PropComponentStateFields
prop_service.def.contract    →  PropServiceDefContract
prop_service.def.handlers    →  PropServiceDefHandlers
```

## Full Type Map

```
prop_component
  .def
    .contract               PropComponentDefContract   (config_fields, state_fields, actions, routes)
    .contract_version       string  (sha256 of contract — does NOT change on context_deps update)
    .context_deps           PropContextDeps            (top-level — swapping dep app never bumps contract_version)
  .app
    .config                 PropComponentAppConfigIntent<T>
    .component_src          string
    .component_types_src    string
    .component_js           string
    .prop_runtime_version   string
  .state
    .fields                 PropComponentStateFields
  .user_state
    .fields                 PropComponentUserStateFields
  .event
    .action_args            PropComponentEventActionArgs
    .action_result          PropComponentEventActionResult
  .session
    .metadata               PropComponentSessionMetadata

prop_service
  .def
    .contract               PropServiceDefContract
    .handlers               PropServiceDefHandlers
  .app
    .config                 PropServiceAppConfigIntent<T>
```

All types defined in `interfaces/types.ts`.
All JSONB columns annotated with `COMMENT ON COLUMN` in `sql/tables.sql`.

## Rule

When adding a new JSONB column:

1. Name the column after what it holds
2. Name the TypeScript type `Prop{Type}{Table}{Column}` (PascalCase each segment)
3. Add a `COMMENT ON COLUMN` in `sql/tables.sql` referencing the TypeScript type name
4. Add the type to `interfaces/types.ts`
