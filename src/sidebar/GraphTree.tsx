import { GraphTreeShell } from './GraphTreeShell'
import { LooseGroups } from './LooseGroups'

/** Hierarchical graphs → subgraphs → nodes view (§WS-4), rooted at the project. */
export function GraphTree() {
  return <GraphTreeShell>{(ctl) => <LooseGroups ctl={ctl} />}</GraphTreeShell>
}
