export type PayloadFormat = 'markdown' | 'plaintext' | 'code'

/** A node's payload references a file (content lives in the files table) or a link URL. */
export type Payload = { kind: 'file'; fileId: string } | { kind: 'link'; url: string }

interface Timestamped {
  createdAt: number
  updatedAt: number
}

export interface NodeRecord extends Timestamped {
  id: string
  title: string
  kindId?: string
  tags: string[]
  /** Short blurb for the graph card — the canvas shows this, never the payload. */
  summary?: string
  /** Undefined ⇒ a pure graph-pointer node with no content. */
  payload?: Payload
  childGraphId?: string
}

export interface FileRecord extends Timestamped {
  id: string
  nodeId: string
  filename: string
  format: PayloadFormat
  language?: string
  content: string
}

export interface GraphRecord extends Timestamped {
  id: string
  name: string
}

export interface PlacementRecord extends Timestamped {
  id: string
  graphId: string
  nodeId: string
  x: number
  y: number
}

export interface EdgeRecord extends Timestamped {
  id: string
  graphId: string
  fromNodeId: string
  toNodeId: string
  relationTypeId: string
}

export interface RelationTypeRecord extends Timestamped {
  id: string
  name: string
  color?: string
}

export interface KindRecord extends Timestamped {
  id: string
  name: string
  color: string
  icon: string
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface WorkspaceBundle {
  schemaVersion: number
  exportedAt: string
  nodes: NodeRecord[]
  graphs: GraphRecord[]
  placements: PlacementRecord[]
  edges: EdgeRecord[]
  relationTypes: RelationTypeRecord[]
  kinds: KindRecord[]
  files: FileRecord[]
  meta: {
    rootGraphId: string | null
    homeGraphId: string | null
  }
}
