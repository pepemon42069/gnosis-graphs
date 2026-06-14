import { useStore } from '@xyflow/react'

const NEAR_ZOOM = 0.55

/** Two discrete levels (§5): cards re-render only when the threshold is crossed. */
export function useLod(): 'far' | 'near' {
  return useStore((s) => (s.transform[2] >= NEAR_ZOOM ? 'near' : 'far'))
}
