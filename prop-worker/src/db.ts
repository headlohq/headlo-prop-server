// PropDB — the interface every DB implementation must satisfy.
// index.ts only ever calls these three methods.
// Swap the import in index.ts to change the backing store.

export interface SyncBody {
  def_id?:          string
  owner_id?:        string
  name?:            string
  component_src?:   string
  component_js?:    string
  component_bundle?: string
}

export interface PropDB {
  getBundle(slug: string): Promise<string | null>
  upsertComponent(slug: string, body: SyncBody): Promise<void>
  listSlugs(): Promise<string[]>
}
