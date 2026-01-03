import type { ResolveResponse } from "@codewheel/jsonapi-frontend-client"

export interface LayoutTree {
  source: string
  view_mode: string
  sections: LayoutSection[]
}

export interface LayoutSection {
  layout_id: string
  layout_settings: Record<string, unknown>
  components: LayoutComponent[]
}

export type LayoutComponent =
  | {
      type: "field"
      uuid: string
      region: string
      weight: number
      plugin_id: string
      field: { entity_type_id: string; bundle: string; field_name: string } | null
      settings?: Record<string, unknown>
    }
  | {
      type: "inline_block"
      uuid: string
      region: string
      weight: number
      plugin_id: string
      inline_block: {
        view_mode: string | null
        block_revision_id: number | null
        block: { type: string; id: string; jsonapi_url: string } | null
      } | null
      settings?: Record<string, unknown>
    }
  | {
      type: "block"
      uuid: string
      region: string
      weight: number
      plugin_id: string
      settings?: Record<string, unknown>
    }

export type LayoutResolveResponse =
  | (Extract<ResolveResponse, { kind: "entity"; resolved: true }> & { layout?: LayoutTree })
  | Exclude<ResolveResponse, { kind: "entity"; resolved: true }>

