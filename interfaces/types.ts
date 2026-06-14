// PROP type definitions — shared across all interface files

// prop_component | prop_service | prop_agent | ... (extensible)
export type PropType = 'component' | 'service'

// ── Primitive building blocks ─────────────────────────────────
// Not tied to a single column — used as values inside contract JSONB fields

// A TypeScript type expressed as a string: 'string', 'number', 'ChatMessage[]', etc.
export type PropTypeRef = string

// Named parameters mapped to their PropTypeRef strings
export type PropArgMap = Record<string, PropTypeRef>

// Runtime values of any *.app.config — keys match contract.config_fields names
export type PropConfigValues = Record<string, any>

// ── Intent types ──────────────────────────────────────────────
// Derived from a specific def (requires `satisfies`) — documents intended shape

// prop_component.app.config
export type PropComponentAppConfigIntent<T extends PropComponentDef> = {
  [K in NonNullable<T['contract']['config_fields']>[number]['name']]: any
}


// prop_component.state.fields
export type PropComponentStateFieldsIntent<T extends PropComponentDef> = {
  [K in NonNullable<T['contract']['state_fields']>[number]['name']]: any
}


// Callable api shape derived from a service def — action names as methods, arg names as params
// Arg/return types are any — serviceTypesToDts fills actual types in Monaco via code-gen
export type PropServiceApi<T extends PropServiceDef> = {
  [A in NonNullable<T['contract']['actions']>[number]['name']]:
    (args: {
      [K in keyof Extract<
        NonNullable<T['contract']['actions']>[number],
        { name: A }
      >['args']]: any
    }) => Promise<any>
}

// prop_component.def.contract  JSONB → config_fields[n] | state_fields[n] | user_state_fields[n]
// prop_service.def.contract    JSONB → config_fields[n]
export interface PropField {
  name:     string
  type:     string    // PropTypeRef string: 'string', 'number', 'ChatMessage[]', etc.
  label?:   string
  default?: any
}

// prop_service.def.contract  JSONB → service_types[name].methods[name]
export interface PropTypeMethod {
  args:    PropArgMap
  returns: PropTypeRef
}

// prop_service.def.contract  JSONB → service_types[name]
export interface PropTypeDef {
  kind:        string                        // 'interface' | 'enum' | 'union' | ... extensible
  methods?:    Record<string, PropTypeMethod>
  properties?: Record<string, PropTypeRef>
  values?:     string[]                      // for kind: 'enum' | 'union'
  [key: string]: any                         // allow custom fields for future kinds
}

// prop_component.def.contract  JSONB → actions[n]
// prop_service.def.contract    JSONB → actions[n]
export interface PropAction {
  name:           string
  args:           PropArgMap
  returns:        PropArgMap | PropTypeRef   // field map, or a named type ref ('SessionHandle', etc.)
  updates_state?: string[]                   // keys in prop_component.state.fields this action writes
}

// prop_component.def.requires  JSONB → external[n]
export interface PropHttpRef {
  url:     string   // base URL — canonical identifier for this external API
  env_var: string   // env var name holding the API key (e.g. POLYGON_API_KEY)
}

// prop_component.def.requires  JSONB → props[n]
export interface PropRef {
  prop_type: string   // matches prop_{prop_type} schema prefix
  def_slug:  string   // prop_{prop_type}.def.slug — canonical name, used as api key in component
}

// prop_component.def.requires  JSONB → mcp[n]
export interface PropMcpTool {
  tool: string   // MCP tool name — used as api key in component
}

// prop_component.def.requires  JSONB
export interface PropRequires {
  props?:    PropRef[]           // any PROP ref — prop_type tells you service | component | agent
  external?: PropHttpRef[]   // external REST APIs proxied through the worker
  mcp?:      PropMcpTool[]        // MCP tools
  auto?:     boolean             // wire own actions as typed methods on api
}

// prop_component.def.contract  JSONB → routes[n]
export interface PropRoute {
  path:      string
  component: string
}

// prop_component.def.contract  JSONB
export interface PropComponentDefContract {
  config_fields?: PropField[]
  state_fields?:  PropField[]
  actions?:       PropAction[]
  routes?:        PropRoute[]
  // requires is top-level on PropComponentDef — changing a PropRef def_slug never bumps contract_version
}

// prop_component.state.fields  JSONB
export type PropComponentStateFields = Record<string, any>

// prop_component.event.action_args  JSONB — runtime values, not PropArgMap type-ref strings
export type PropComponentEventActionArgs = Record<string, any>

// prop_component.event.action_result  JSONB
export type PropComponentEventActionResult = Record<string, any>

// prop_component.session.metadata  JSONB
export type PropComponentSessionMetadata = Record<string, any>

// prop_service.def.contract  JSONB
export interface PropServiceDefContract {
  config_fields?:  PropField[]
  actions?:        PropAction[]
  service_types?:  Record<string, PropTypeDef>
}

// prop_service.def.handlers  JSONB → [action_name].updates_state
export type PropServiceDefHandlers = Record<string, { updates_state?: string[] }>

// prop_component.def
export interface PropComponentDef {
  def_id?:           string        // omitted when constructing before insert
  slug:              string
  prop_type:         'component'
  owner_id?:         string        // set by the platform on save
  name:              string
  stage:             'draft' | 'stable' | 'locked'
  contract:          PropComponentDefContract
  contract_version?: string        // sha256(JSON.stringify(contract)) — does NOT change on requires update
  requires?:         PropRequires
  public_path?:      string
  is_public?:        boolean
  created_at?:       string        // TIMESTAMPTZ — omitted when constructing
}

// prop_service.def
export interface PropServiceDef {
  def_id?:           string        // omitted when constructing before insert
  slug:              string
  prop_type:         'service'
  owner_id?:         string        // set by the platform on save
  name:              string
  stage:             'draft' | 'stable' | 'locked'
  contract:          PropServiceDefContract
  contract_version?: string        // sha256(JSON.stringify(contract)) — auto-updated on save
  handlers:          PropServiceDefHandlers
  public_path?:      string
  is_public?:        boolean
  created_at?:       string        // TIMESTAMPTZ — omitted when constructing
}

// prop_component.app
export interface PropComponentApp {
  app_id?:               string   // omitted when constructing before insert
  def_id?:               string   // prop_component.def.def_id
  slug:                  string
  owner_id?:             string
  config:                PropConfigValues
  component_src?:        string   // TypeScript/JSX — the component function
  component_types_src?:  string   // TypeScript .d.ts — injected as virtual file in Monaco
  component_js?:         string   // compiled output (loaded by useCompCache at runtime)
  prop_runtime_version?: string   // contract_version at last compile — mismatch triggers recompile
  created_at?:           string
  updated_at?:           string
}

